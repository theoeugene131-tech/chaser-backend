import { db } from "../lib/db";
import { Invoice, Payment } from "../types";
import { nanoid } from "nanoid";

/**
 * Matches a payment to an open invoice.
 *
 * Strategy (in priority order):
 *  1. Exact amount match against a single open invoice for the same customer.
 *  2. Sum of two or more open invoices for the customer that exactly equals
 *     the payment (covers "customer paid three invoices in one wire").
 *  3. Closest-amount match within a tolerance, flagged for human review
 *     rather than auto-closed — this mirrors "we chase and match, but
 *     escalate anything ambiguous instead of guessing silently."
 *
 * Returns the matched invoice ids (empty if nothing matched confidently).
 */
export async function matchPayment(payment: Payment): Promise<{ matchedInvoiceIds: string[]; needsReview: boolean }> {
  const openInvoices = ((await db.table("invoices")) as Invoice[]).filter(
    (inv) => inv.orgId === payment.orgId && inv.customerId === payment.customerId && inv.status !== "paid"
  );

  // 1. Single exact match
  const exact = openInvoices.find((inv) => inv.amountCents - inv.amountPaidCents === payment.amountCents);
  if (exact) {
    await applyPaymentToInvoice(exact, payment);
    return { matchedInvoiceIds: [exact.id], needsReview: false };
  }

  // 2. Combination match (simple subset-sum over open invoices, capped small since AR customers rarely batch >6 invoices)
  const combo = findSubsetSum(openInvoices, payment.amountCents);
  if (combo) {
    for (const inv of combo) await applyPaymentToInvoice(inv, payment, combo.length);
    return { matchedInvoiceIds: combo.map((i) => i.id), needsReview: false };
  }

  // 3. Closest match within 2% tolerance -> flag for review, don't auto-close
  const tolerance = payment.amountCents * 0.02;
  const closest = openInvoices
    .map((inv) => ({ inv, diff: Math.abs(inv.amountCents - inv.amountPaidCents - payment.amountCents) }))
    .filter((x) => x.diff <= tolerance)
    .sort((a, b) => a.diff - b.diff)[0];

  if (closest) {
    await db.insert("inboxEvents", {
      id: nanoid(),
      orgId: payment.orgId,
      type: "matched",
      customerId: payment.customerId,
      invoiceId: closest.inv.id,
      detail: `Payment of ${formatCents(payment.amountCents)} is close to invoice ${closest.inv.number} but doesn't match exactly — flagged for review`,
      createdAt: new Date().toISOString(),
    });
    return { matchedInvoiceIds: [], needsReview: true };
  }

  return { matchedInvoiceIds: [], needsReview: true };
}

async function applyPaymentToInvoice(invoice: Invoice, payment: Payment, splitAcross = 1) {
  const share = Math.round(payment.amountCents / splitAcross);
  const newPaid = invoice.amountPaidCents + share;
  const fullyPaid = newPaid >= invoice.amountCents;

  await db.update("invoices", invoice.id, {
    amountPaidCents: newPaid,
    status: fullyPaid ? "paid" : invoice.status,
    updatedAt: new Date().toISOString(),
  });

  await db.update("payments", payment.id, { invoiceId: invoice.id, matched: true });

  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId: payment.orgId,
    type: fullyPaid ? "paid" : "matched",
    customerId: payment.customerId,
    invoiceId: invoice.id,
    detail: fullyPaid
      ? `${formatCents(share)} received via ${payment.source} — invoice ${invoice.number} closed`
      : `Remittance matched to invoice ${invoice.number} via ${payment.source}`,
    createdAt: new Date().toISOString(),
  });
}

function findSubsetSum(invoices: Invoice[], targetCents: number, maxSize = 5): Invoice[] | null {
  const candidates = invoices.filter((i) => i.amountCents - i.amountPaidCents <= targetCents);
  const n = Math.min(candidates.length, 12); // cap for perf; AR batches this large are rare

  function search(start: number, remaining: number, chosen: Invoice[]): Invoice[] | null {
    if (remaining === 0 && chosen.length >= 2) return chosen;
    if (remaining < 0 || chosen.length >= maxSize) return null;
    for (let i = start; i < n; i++) {
      const inv = candidates[i];
      const open = inv.amountCents - inv.amountPaidCents;
      const result = search(i + 1, remaining - open, [...chosen, inv]);
      if (result) return result;
    }
    return null;
  }

  return search(0, targetCents, []);
}

function formatCents(cents: number) {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}
