import { db } from "../lib/db";
import { Invoice } from "../types";
import { nanoid } from "nanoid";

/**
 * Default cadence, in days-past-due, if an org hasn't customized its
 * escalation rules. Mirrors the pitch copy: friendly nudge -> firmer
 * reminders -> human escalation.
 */
const DEFAULT_CADENCE = [
  { daysPastDue: -3, action: "reminder" as const, tone: "Invoice due soon — friendly nudge sent" },
  { daysPastDue: 1, action: "reminder" as const, tone: "1st overdue reminder sent" },
  { daysPastDue: 14, action: "reminder" as const, tone: "2nd reminder sent — tone firmed up" },
  { daysPastDue: 30, action: "reminder" as const, tone: "3rd and final reminder sent" },
  { daysPastDue: 45, action: "escalate" as const, tone: "No response after 3 touches — routed to a collections specialist" },
];

/**
 * Runs the cadence against every open invoice for an org. In production
 * this is triggered by a scheduled job (cron / queue worker) — see
 * README "Running the daily job". Each run is idempotent: an invoice
 * only fires the next matching step once, tracked via reminderCount.
 */
export async function runEscalationSweep(orgId: string): Promise<{ touched: number }> {
  const invoices = ((await db.table("invoices")) as Invoice[]).filter(
    (inv) => inv.orgId === orgId && inv.status !== "paid" && inv.status !== "disputed"
  );

  const today = new Date();
  let touched = 0;

  for (const invoice of invoices) {
    const daysPastDue = Math.floor((today.getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000);
    const step = [...DEFAULT_CADENCE].reverse().find((s) => daysPastDue >= s.daysPastDue);
    if (!step) continue;

    const stepIndex = DEFAULT_CADENCE.indexOf(step);
    if (invoice.reminderCount > stepIndex) continue; // already fired this step or later

    const isEscalation = step.action === "escalate";

    await db.update("invoices", invoice.id, {
      status: isEscalation ? "escalated" : "reminder",
      reminderCount: stepIndex + 1,
      lastReminderAt: today.toISOString(),
      updatedAt: today.toISOString(),
    });

    await db.insert("inboxEvents", {
      id: nanoid(),
      orgId,
      type: isEscalation ? "escalated" : "reminder",
      customerId: invoice.customerId,
      invoiceId: invoice.id,
      detail: `${step.tone} — invoice ${invoice.number}`,
      createdAt: today.toISOString(),
    });

    touched += 1;
  }

  return { touched };
}
