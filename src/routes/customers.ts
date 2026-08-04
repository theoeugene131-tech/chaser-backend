import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { Customer, Invoice } from "../types";

export const customersRouter = Router();
customersRouter.use(requireAuth);

const createCustomerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

// Manually add a customer — the path into the app for anyone who hasn't
// connected a real integration yet (Stripe/QuickBooks/etc. create customers
// automatically on sync; this covers everyone else).
customersRouter.post("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const customer: Customer = {
    id: nanoid(),
    orgId,
    name: parsed.data.name,
    email: parsed.data.email,
    externalIds: {},
    createdAt: new Date().toISOString(),
  };
  await db.insert("customers", customer);

  res.status(201).json({ customer });
});

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

// Delete a customer — blocked if they have any invoices, so you can't
// accidentally orphan real billing history. Delete/reassign those first.
customersRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const customer = (await db.find("customers", String(req.params.id))) as Customer | null;
  if (!customer || customer.orgId !== orgId) return res.status(404).json({ error: "Customer not found" });

  const theirInvoices = ((await db.table("invoices")) as Invoice[]).filter(
    (i) => i.orgId === orgId && i.customerId === customer.id
  );
  if (theirInvoices.length > 0) {
    return res.status(400).json({
      error: `This customer has ${theirInvoices.length} invoice(s). Delete those first before removing the customer.`,
    });
  }

  await db.delete("customers", customer.id);
  res.json({ ok: true });
});
