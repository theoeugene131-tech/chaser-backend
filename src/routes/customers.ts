import { Router } from "express";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { Customer, Invoice } from "../types";

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const customers = ((await db.table("customers")) as Customer[]).filter((c) => c.orgId === orgId);
  const invoices = ((await db.table("invoices")) as Invoice[]).filter((i) => i.orgId === orgId);

  const result = customers.map((c) => {
    const theirs = invoices.filter((i) => i.customerId === c.id && i.status !== "paid");
    const openCents = theirs.reduce((sum, i) => sum + (i.amountCents - i.amountPaidCents), 0);
    const worstDaysPastDue = theirs.reduce((max, i) => {
      const d = Math.floor((Date.now() - new Date(i.dueDate).getTime()) / 86_400_000);
      return Math.max(max, d);
    }, 0);
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      openCents,
      openInvoiceCount: theirs.length,
      worstDaysPastDue,
    };
  });

  res.json({ customers: result.sort((a, b) => b.openCents - a.openCents) });
});
