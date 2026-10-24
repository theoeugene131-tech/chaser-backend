import { db } from "../lib/db";
import { Invoice, Organization } from "../types";
import { nanoid } from "nanoid";
import { daysPastDue, sendCustomerReminder, sendEscalationAlert, ReminderOutcome } from "./reminders";

const DEFAULT_CADENCE = [
  { daysPastDue: -3, action: "reminder" as const, label: "Due-soon reminder" },
  { daysPastDue: 1, action: "reminder" as const, label: "First overdue reminder" },
  { daysPastDue: 14, action: "reminder" as const, label: "Second reminder" },
  { daysPastDue: 30, action: "reminder" as const, label: "Final reminder" },
  { daysPastDue: 45, action: "escalate" as const, label: "Human follow-up escalation" },
];

export interface SweepResult {
  touched: number;
  sent: number;
  logged: number;
  skipped: number;
  failed: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runEscalationSweep(orgId: string): Promise<SweepResult> {
  const invoices = ((await db.table("invoices")) as Invoice[]).filter(
    (invoice) => invoice.orgId === orgId && invoice.status !== "paid" && invoice.status !== "disputed",
  );
  const result: SweepResult = { touched: 0, sent: 0, logged: 0, skipped: 0, failed: 0 };
  const now = new Date();

  for (const invoice of invoices) {
    const days = daysPastDue(invoice, now);
    const step = [...DEFAULT_CADENCE].reverse().find((candidate) => days >= candidate.daysPastDue);
    if (!step) continue;
    const stepIndex = DEFAULT_CADENCE.indexOf(step);
    if ((invoice.reminderCount || 0) > stepIndex) continue;

    const escalation = step.action === "escalate";
    const outcome: ReminderOutcome = escalation
      ? await sendEscalationAlert(invoice, now)
      : await sendCustomerReminder(invoice, now);

    if (outcome.status === "failed") {
      result.failed += 1;
      console.error(`[sweep] Invoice ${invoice.number}: ${outcome.detail}`);
      continue;
    }
    // Do not advance the cadence unless an email provider confirms delivery
    // acceptance. This also prevents development-mode log-only results and
    // missing escalation recipients from being recorded as completed reminders.
    if (outcome.status !== "sent") {
      if (outcome.status === "logged") result.logged += 1;
      else result.skipped += 1;
      continue;
    }

    await db.update("invoices", invoice.id, {
      status: escalation ? "escalated" : "reminder",
      reminderCount: stepIndex + 1,
      lastReminderAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    await db.insert("inboxEvents", {
      id: nanoid(),
      orgId,
      type: escalation ? "escalated" : "reminder",
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      detail: `${step.label} — invoice ${invoice.number} (${outcome.detail})`,
      createdAt: now.toISOString(),
    });

    result.touched += 1;
    if (outcome.status === "sent") {
      result.sent += 1;
      await sleep(600);
    } else if (outcome.status === "logged") {
      result.logged += 1;
    } else {
      result.skipped += 1;
    }
  }
  return result;
}

export async function runAllOrgsSweep(): Promise<Record<string, SweepResult>> {
  const organizations = (await db.table("organizations")) as Organization[];
  const results: Record<string, SweepResult> = {};
  for (const organization of organizations) {
    try {
      results[organization.id] = await runEscalationSweep(organization.id);
    } catch (error) {
      console.error(`[sweep] Organization ${organization.id} failed:`, error);
      results[organization.id] = { touched: 0, sent: 0, logged: 0, skipped: 0, failed: 1 };
    }
  }
  return results;
}
