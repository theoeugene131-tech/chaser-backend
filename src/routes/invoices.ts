import { Router } from "express";
import { nanoid } from "nanoid";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { Invoice, Customer } from "../types";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

invoicesRouter.get("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const qRaw = req.query.q;
  const q = typeof qRaw === "string" ? qRaw.toLowerCase() : undefined;

  const customers = (await db.table("customers")) as Customer[];
  let invoices = ((await db.table("invoices")) as Invoice[]).filter((i) => i.orgId === orgId);

  const enriched = invoices.map((inv) => {
    const customer = customers.find((c) => c.id === inv.customerId);
    const daysPastDue = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86_400_000);
    return { ...inv, customerName: customer?.name ?? "Unknown", daysPastDue };
  });

  const filtered = q
    ? enriched.filter((i) => i.customerName.toLowerCase().includes(q) || i.number.toLowerCase().includes(q))
    : enriched;

  res.json({ invoices: filtered.sort((a, b) => b.daysPastDue - a.daysPastDue) });
});

// Manually fire a reminder outside the normal cadence (e.g. AR manager clicks "nudge now").
invoicesRouter.post("/:id/remind", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  await db.update("invoices", invoice.id, {
    status: "reminder",
    lastReminderAt: new Date().toISOString(),
    reminderCount: invoice.reminderCount + 1,
  });

  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "reminder",
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    detail: `Manual reminder sent for invoice ${invoice.number}`,
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});

invoicesRouter.post("/:id/escalate", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  await db.update("invoices", invoice.id, { status: "escalated" });

  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "escalated",
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    detail: `Invoice ${invoice.number} manually escalated to a collections specialist`,
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});
