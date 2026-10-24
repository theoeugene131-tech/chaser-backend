import { db } from "../lib/db";
import { escapeHtml, sendEmail } from "../lib/reminderEmail";
import { Customer, Invoice, Organization, User } from "../types";

export type Tone = "friendly" | "overdue" | "firm" | "final";
export type ReminderOutcome =
  | { status: "sent"; detail: string }
  | { status: "logged"; detail: string }
  | { status: "skipped"; detail: string }
  | { status: "failed"; detail: string };

export function toneFor(days: number): Tone {
  if (days < 1) return "friendly";
  if (days < 14) return "overdue";
  if (days < 30) return "firm";
  return "final";
}

export function daysPastDue(invoice: Pick<Invoice, "dueDate">, now = new Date()): number {
  return Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86_400_000);
}

const LOCALES: Record<string, string> = {
  NGN: "en-NG", GHS: "en-GH", KES: "en-KE", ZAR: "en-ZA",
  GBP: "en-GB", EUR: "en-IE", USD: "en-US",
};

export function formatAmount(cents: number, currency: string): string {
  const code = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat(LOCALES[code] || "en", { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function orgContext(orgId: string): Promise<{ org: Organization | null; team: User[] }> {
  const [organizations, users] = await Promise.all([db.table("organizations"), db.table("users")]);
  return {
    org: (organizations as Organization[]).find((item) => item.id === orgId) ?? null,
    team: (users as User[]).filter((user) => user.orgId === orgId && user.emailVerified),
  };
}

export async function sendCustomerReminder(invoice: Invoice, now = new Date()): Promise<ReminderOutcome> {
  try {
    const customer = (await db.find("customers", invoice.customerId)) as Customer | null;
    if (!customer || customer.orgId !== invoice.orgId) return { status: "skipped", detail: "customer not found for this business" };
    if (!customer.email?.trim()) return { status: "skipped", detail: "customer has no email address" };

    const { org, team } = await orgContext(invoice.orgId);
    const days = daysPastDue(invoice, now);
    const tone = toneFor(days);
    const amount = formatAmount(Math.max(0, invoice.amountCents - (invoice.amountPaidCents || 0)), invoice.currency);
    const due = formatDate(invoice.dueDate);
    const subject: Record<Tone, string> = {
      friendly: `Invoice ${invoice.number} from ${org?.name || "your supplier"} is due soon`,
      overdue: `Invoice ${invoice.number} is overdue`,
      firm: `Second reminder: invoice ${invoice.number} is ${days} days overdue`,
      final: `Final reminder: invoice ${invoice.number} is ${days} days overdue`,
    };
    const lead: Record<Tone, string> = {
      friendly: `A quick note that invoice ${invoice.number} for ${amount} is due on ${due}.`,
      overdue: `Our records show invoice ${invoice.number} for ${amount} was due on ${due} and remains unpaid.`,
      firm: `Invoice ${invoice.number} for ${amount} was due on ${due} and is now ${days} days overdue.`,
      final: `This is our final reminder. Invoice ${invoice.number} for ${amount}, due on ${due}, is ${days} days overdue.`,
    };
    const close: Record<Tone, string> = {
      friendly: "If you have already arranged payment, thank you and please ignore this message.",
      overdue: "If you have already paid, please reply with the date and reference so we can update our records.",
      firm: "Please arrange payment or reply with the expected payment date. If anything is wrong with the invoice, let us know.",
      final: "Please pay promptly or reply today so we can agree on a way forward. If you dispute this invoice, please tell us why.",
    };
    const orgName = org?.name || "Your supplier";
    const text = `Hello ${customer.name},\n\n${lead[tone]}\n\n${close[tone]}\n\nYou can reply directly to this email.\n\nRegards,\n${orgName}`;
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;line-height:1.5"><p>Hello ${escapeHtml(customer.name)},</p><p>${escapeHtml(lead[tone])}</p><p>${escapeHtml(close[tone])}</p><p>You can reply directly to this email.</p><p>Regards,<br>${escapeHtml(orgName)}</p></div>`;
    const result = await sendEmail({ to: customer.email.trim(), subject: subject[tone], text, html, fromName: orgName, replyTo: team[0]?.email });
    return result.sent ? { status: "sent", detail: `emailed ${customer.email}` } : { status: "logged", detail: "development mode: email was not sent" };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : "email provider error" };
  }
}

export async function sendEscalationAlert(invoice: Invoice, now = new Date()): Promise<ReminderOutcome> {
  try {
    const customer = (await db.find("customers", invoice.customerId)) as Customer | null;
    const { org, team } = await orgContext(invoice.orgId);
    if (!team.length) return { status: "skipped", detail: "no team member available for notification" };
    if (customer && customer.orgId !== invoice.orgId) return { status: "failed", detail: "customer does not belong to this business" };

    const days = daysPastDue(invoice, now);
    const amount = formatAmount(Math.max(0, invoice.amountCents - (invoice.amountPaidCents || 0)), invoice.currency);
    const who = customer?.name || "a customer";
    const subject = `Needs follow-up: invoice ${invoice.number} (${who}) is ${days} days overdue`;
    const text = `Invoice ${invoice.number} for ${who} (${amount} outstanding) is ${days} days overdue and has had ${invoice.reminderCount} automated reminders.\n\nAutomated reminders have stopped. Please contact them personally.`;
    const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;line-height:1.5"><p>Invoice <strong>${escapeHtml(invoice.number)}</strong> for <strong>${escapeHtml(who)}</strong> (${escapeHtml(amount)} outstanding) is ${days} days overdue and has had ${invoice.reminderCount} automated reminders.</p><p>Automated reminders have stopped. Please contact them personally.</p></div>`;
    let sent = 0;
    for (const member of team) {
      const result = await sendEmail({ to: member.email, subject, text, html, fromName: org?.name || "Invoice Chaser" });
      if (result.sent) sent += 1;
    }
    return sent ? { status: "sent", detail: `alerted ${sent} team member(s)` } : { status: "logged", detail: "development mode: alert was not sent" };
  } catch (error) {
    return { status: "failed", detail: error instanceof Error ? error.message : "email provider error" };
  }
}
