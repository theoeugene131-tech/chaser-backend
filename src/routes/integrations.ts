import { Router } from "express";
import { nanoid } from "nanoid";
import { AuthedRequest, requireAuth } from "../middleware/requireAuth";
import { db } from "../lib/db";
import { getAdapter, SUPPORTED_PROVIDERS } from "../integrations/registry";
import { IntegrationConnection, IntegrationProvider, Customer, Invoice, Payment } from "../types";
import { matchPayment } from "../services/matching";

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

integrationsRouter.get("/", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const connections = ((await db.table("integrationConnections")) as IntegrationConnection[]).filter((c) => c.orgId === orgId);

  const all = SUPPORTED_PROVIDERS.map((provider) => {
    const existing = connections.find((c) => c.provider === provider);
    return (
      existing ?? {
        id: nanoid(),
        orgId,
        provider,
        connected: false,
        credentials: null,
        lastSyncedAt: null,
      }
    );
  });

  res.json({ integrations: all.map(({ credentials, ...safe }) => safe) }); // never leak credentials to the client
});

integrationsRouter.post("/:provider/connect", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const provider = req.params.provider as IntegrationProvider;
  const adapter = getAdapter(provider);
  if (!adapter) return res.status(400).json({ error: `Unsupported provider: ${provider}` });

  const credentials = req.body?.credentials ?? {};
  const result = await adapter.connect(credentials);
  if (!result.ok) return res.status(400).json({ error: result.error });

  const existing = ((await db.table("integrationConnections")) as IntegrationConnection[]).find(
    (c) => c.orgId === orgId && c.provider === provider
  );

  if (existing) {
    await db.update("integrationConnections", existing.id, { connected: true, credentials });
  } else {
    await db.insert("integrationConnections", {
      id: nanoid(),
      orgId,
      provider,
      connected: true,
      credentials,
      lastSyncedAt: null,
    });
  }

  res.json({ ok: true });
});

// Pulls invoices + payments from the provider, upserts them, and runs matching.
integrationsRouter.post("/:provider/sync", async (req: AuthedRequest, res) => {
  const orgId = req.auth!.orgId;
  const provider = req.params.provider as IntegrationProvider;
  const adapter = getAdapter(provider);
  if (!adapter) return res.status(400).json({ error: `Unsupported provider: ${provider}` });

  const connection = ((await db.table("integrationConnections")) as IntegrationConnection[]).find(
    (c) => c.orgId === orgId && c.provider === provider && c.connected
  );
  if (!connection) return res.status(400).json({ error: `${provider} is not connected` });

  const credentials = connection.credentials ?? {};
  const [remoteInvoices, remotePayments] = await Promise.all([
    adapter.fetchInvoices(credentials, connection.lastSyncedAt ?? undefined),
    adapter.fetchPayments(credentials, connection.lastSyncedAt ?? undefined),
  ]);

  let newInvoices = 0;
  for (const ri of remoteInvoices) {
    let customer = ((await db.table("customers")) as Customer[]).find(
      (c) => c.orgId === orgId && c.externalIds[provider] === ri.customerExternalId
    );
    if (!customer) {
      customer = {
        id: nanoid(),
        orgId,
        name: ri.customerName,
        email: ri.customerEmail,
        externalIds: { [provider]: ri.customerExternalId },
        createdAt: new Date().toISOString(),
      };
      await db.insert("customers", customer);
    }

    const already = ((await db.table("invoices")) as Invoice[]).find(
      (i) => i.orgId === orgId && i.externalId === ri.externalId && i.source === provider
    );
    if (already) continue;

    await db.insert("invoices", {
      id: nanoid(),
      orgId,
      customerId: customer.id,
      number: ri.number,
      amountCents: ri.amountCents,
      amountPaidCents: 0,
      currency: ri.currency,
      dueDate: ri.dueDate,
      issuedDate: ri.issuedDate,
      status: "current",
      source: provider,
      externalId: ri.externalId,
      lastReminderAt: null,
      reminderCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    newInvoices += 1;
  }

  let matchedCount = 0;
  for (const rp of remotePayments) {
    const customer = ((await db.table("customers")) as Customer[]).find(
      (c) => c.orgId === orgId && c.externalIds[provider] === rp.customerExternalId
    );
    if (!customer) continue;

    const already = ((await db.table("payments")) as Payment[]).find(
      (p) => p.orgId === orgId && p.externalRef === rp.externalRef && p.source === provider
    );
    if (already) continue;

    const payment: Payment = {
      id: nanoid(),
      orgId,
      customerId: customer.id,
      invoiceId: null,
      amountCents: rp.amountCents,
      currency: rp.currency,
      receivedAt: rp.receivedAt,
      source: provider,
      externalRef: rp.externalRef,
      matched: false,
      createdAt: new Date().toISOString(),
    };
    await db.insert("payments", payment);

    const { matchedInvoiceIds } = await matchPayment(payment);
    if (matchedInvoiceIds.length) matchedCount += 1;
  }

  await db.update("integrationConnections", connection.id, { lastSyncedAt: new Date().toISOString() });

  res.json({ ok: true, newInvoices, paymentsMatched: matchedCount, paymentsSeen: remotePayments.length });
});
