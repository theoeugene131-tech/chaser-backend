import { Router } from "express";
import { nanoid } from "nanoid";
import { z } from "zod";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { Invoice, Customer } from "../types";

export const invoicesRouter = Router();
invoicesRouter.use(requireAuth);

const createInvoiceSchema = z.object({
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  customerEmail: z.string().email().optional(),
  number: z.string().min(1),
  amountCents: z.number().int().positive(),
  dueDate: z.string(),
  currency: z.string().default("usd"),
});

// Manually add an invoice. Pass an existing customerId, or a
// customerName + customerEmail to create the customer in the same step —
// this is the path for anyone entering invoices by hand rather than
// syncing them from a connected integration.
invoicesRouter.post("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const parsed = createInvoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { customerId, customerName, customerEmail, number, amountCents, dueDate, currency } = parsed.data;

  let resolvedCustomerId = customerId;

  if (!resolvedCustomerId) {
    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: "Provide customerId, or both customerName and customerEmail" });
    }
    const customer: Customer = {
      id: nanoid(),
      orgId,
      name: customerName,
      email: customerEmail,
      externalIds: {},
      createdAt: new Date().toISOString(),
    };
    await db.insert("customers", customer);
    resolvedCustomerId = customer.id;
  } else {
    const existing = (await db.find("customers", resolvedCustomerId)) as Customer | null;
    if (!existing || existing.orgId !== orgId) return res.status(404).json({ error: "Customer not found" });
  }

  const now = new Date().toISOString();
  const invoice: Invoice = {
    id: nanoid(),
    orgId,
    customerId: resolvedCustomerId,
    number,
    amountCents,
    amountPaidCents: 0,
    currency,
    dueDate: new Date(dueDate).toISOString(),
    issuedDate: now,
    status: "current",
    source: "manual",
    externalId: null,
    lastReminderAt: null,
    reminderCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert("invoices", invoice);

  res.status(201).json({ invoice });
});

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

// --- Manual operations for running collections by hand ---

const recordPaymentSchema = z.object({
  amountCents: z.number().int().positive(),
  receivedAt: z.string().optional(),
  note: z.string().optional(),
});

// Record a payment that arrived outside any connected integration —
// a check, a bank transfer, cash, whatever. This is the core action a
// manually-run collections process needs and previously had no path to.
invoicesRouter.post("/:id/record-payment", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { amountCents, receivedAt, note } = parsed.data;

  const now = new Date().toISOString();
  const newPaidCents = invoice.amountPaidCents + amountCents;
  const fullyPaid = newPaidCents >= invoice.amountCents;

  await db.update("invoices", invoice.id, {
    amountPaidCents: newPaidCents,
    status: fullyPaid ? "paid" : invoice.status,
    updatedAt: now,
  });

  await db.insert("payments", {
    id: nanoid(),
    orgId,
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    amountCents,
    currency: invoice.currency,
    receivedAt: receivedAt ? new Date(receivedAt).toISOString() : now,
    source: "manual",
    externalRef: null,
    matched: true,
    createdAt: now,
  });

  const amountLabel = `$${(amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "paid",
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    detail: fullyPaid
      ? `${amountLabel} recorded manually — invoice ${invoice.number} closed${note ? ` (${note})` : ""}`
      : `${amountLabel} recorded manually against invoice ${invoice.number}${note ? ` (${note})` : ""}`,
    createdAt: now,
  });

  res.json({ ok: true, fullyPaid });
});

const addNoteSchema = z.object({ note: z.string().min(1) });

// Log a free-form note — a call, an email sent outside the system, a
// promise-to-pay date, anything the AR team wants on record. Doesn't
// change the invoice's status, just adds to its activity history.
invoicesRouter.post("/:id/note", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  const parsed = addNoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "note",
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    detail: `${parsed.data.note} (invoice ${invoice.number})`,
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({ ok: true });
});

const disputeSchema = z.object({ reason: z.string().optional() });

invoicesRouter.post("/:id/dispute", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  const parsed = disputeSchema.safeParse(req.body);
  const reason = parsed.success ? parsed.data.reason : undefined;

  await db.update("invoices", invoice.id, { status: "disputed", updatedAt: new Date().toISOString() });

  await db.insert("inboxEvents", {
    id: nanoid(),
    orgId,
    type: "disputed",
    customerId: invoice.customerId,
    invoiceId: invoice.id,
    detail: `Invoice ${invoice.number} marked disputed${reason ? ` — ${reason}` : ""}`,
    createdAt: new Date().toISOString(),
  });

  res.json({ ok: true });
});

const editInvoiceSchema = z.object({
  number: z.string().min(1).optional(),
  amountCents: z.number().int().positive().optional(),
  dueDate: z.string().optional(),
});

invoicesRouter.patch("/:id", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  const parsed = editInvoiceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (parsed.data.number !== undefined) patch.number = parsed.data.number;
  if (parsed.data.amountCents !== undefined) patch.amountCents = parsed.data.amountCents;
  if (parsed.data.dueDate !== undefined) patch.dueDate = new Date(parsed.data.dueDate).toISOString();

  const updated = await db.update("invoices", invoice.id, patch);
  res.json({ invoice: updated });
});

invoicesRouter.delete("/:id", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const invoice = (await db.find("invoices", String(req.params.id))) as Invoice | null;
  if (!invoice || invoice.orgId !== orgId) return res.status(404).json({ error: "Invoice not found" });

  await db.delete("invoices", invoice.id);
  res.json({ ok: true });
});
