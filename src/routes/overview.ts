import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { Invoice, Payment } from "../types";

export const overviewRouter = Router();
overviewRouter.use(requireAuth);

overviewRouter.get("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoices = ((await db.table("invoices")) as Invoice[]).filter((i) => i.orgId === orgId);
  const payments = ((await db.table("payments")) as Payment[]).filter((p) => p.orgId === orgId);

  const outstandingCents = invoices
    .filter((i) => i.status !== "paid")
    .reduce((sum, i) => sum + (i.amountCents - i.amountPaidCents), 0);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const collectedThisMonthCents = payments
    .filter((p) => new Date(p.receivedAt) >= startOfMonth)
    .reduce((sum, p) => sum + p.amountCents, 0);

  const openCount = invoices.filter((i) => i.status !== "paid").length;
  const paidCount = invoices.filter((i) => i.status === "paid").length;
  const recoveryRate = invoices.length ? paidCount / invoices.length : 0;

  const avgDso = computeDso(invoices);

  const aging = bucketAging(invoices, now);

  const cashTrend = last6Months(payments);

  res.json({
    cashCollectedThisMonthCents: collectedThisMonthCents,
    outstandingCents,
    openInvoiceCount: openCount,
    avgDaysSalesOutstanding: avgDso,
    recoveryRate,
    aging,
    cashTrend,
  });
});

function computeDso(invoices: Invoice[]): number {
  const paid = invoices.filter((i) => i.status === "paid");
  if (!paid.length) return 0;
  const totalDays = paid.reduce((sum, i) => {
    const issued = new Date(i.issuedDate).getTime();
    const closed = new Date(i.updatedAt).getTime();
    return sum + Math.max(0, (closed - issued) / 86_400_000);
  }, 0);
  return Math.round((totalDays / paid.length) * 10) / 10;
}

function bucketAging(invoices: Invoice[], now: Date) {
  const buckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const inv of invoices) {
    if (inv.status === "paid") continue;
    const daysPastDue = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86_400_000);
    const open = inv.amountCents - inv.amountPaidCents;
    if (daysPastDue <= 0) buckets.current += open;
    else if (daysPastDue <= 30) buckets["1-30"] += open;
    else if (daysPastDue <= 60) buckets["31-60"] += open;
    else if (daysPastDue <= 90) buckets["61-90"] += open;
    else buckets["90+"] += open;
  }
  return buckets;
}

function last6Months(payments: Payment[]) {
  const months: { month: string; collectedCents: number }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const label = d.toLocaleString("en-US", { month: "short" });
    const collectedCents = payments
      .filter((p) => {
        const t = new Date(p.receivedAt).getTime();
        return t >= d.getTime() && t < next.getTime();
      })
      .reduce((sum, p) => sum + p.amountCents, 0);
    months.push({ month: label, collectedCents });
  }
  return months;
}
