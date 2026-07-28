import { IntegrationAdapter, RemoteInvoice, RemotePayment } from "./types";

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Stripe adapter.
 *
 * If credentials.secretKey is set, this calls the real Stripe API
 * (Invoices + Charges/PaymentIntents endpoints). If not, it returns
 * mock data so the rest of the app is fully exercisable in demo mode.
 *
 * To go live: set STRIPE_SECRET_KEY in .env and connect it via
 * POST /api/integrations/stripe/connect.
 */
export const stripeAdapter: IntegrationAdapter = {
  provider: "stripe",

  async connect(credentials) {
    if (!credentials.secretKey) return { ok: false, error: "Missing secretKey" };
    try {
      const res = await fetch(`${STRIPE_API}/balance`, {
        headers: { Authorization: `Bearer ${credentials.secretKey}` },
      });
      if (!res.ok) return { ok: false, error: `Stripe rejected the key (${res.status})` };
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message ?? "Network error reaching Stripe" };
    }
  },

  async fetchInvoices(credentials, since) {
    if (!credentials.secretKey) return mockInvoices();

    const params = new URLSearchParams({ limit: "100", status: "open" });
    if (since) params.set("created[gte]", String(Math.floor(new Date(since).getTime() / 1000)));

    const res = await fetch(`${STRIPE_API}/invoices?${params.toString()}`, {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
    });
    if (!res.ok) throw new Error(`Stripe fetchInvoices failed: ${res.status}`);
    const json: any = await res.json();

    return (json.data as any[]).map((inv): RemoteInvoice => ({
      externalId: inv.id,
      customerExternalId: inv.customer,
      customerName: inv.customer_name ?? "Unknown customer",
      customerEmail: inv.customer_email ?? "",
      number: inv.number ?? inv.id,
      amountCents: inv.amount_due,
      currency: inv.currency,
      dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : new Date().toISOString(),
      issuedDate: new Date(inv.created * 1000).toISOString(),
    }));
  },

  async fetchPayments(credentials, since) {
    if (!credentials.secretKey) return mockPayments();

    const params = new URLSearchParams({ limit: "100" });
    if (since) params.set("created[gte]", String(Math.floor(new Date(since).getTime() / 1000)));

    const res = await fetch(`${STRIPE_API}/charges?${params.toString()}`, {
      headers: { Authorization: `Bearer ${credentials.secretKey}` },
    });
    if (!res.ok) throw new Error(`Stripe fetchPayments failed: ${res.status}`);
    const json: any = await res.json();

    return (json.data as any[])
      .filter((c) => c.paid)
      .map((c): RemotePayment => ({
        externalRef: c.id,
        customerExternalId: c.customer,
        amountCents: c.amount,
        currency: c.currency,
        receivedAt: new Date(c.created * 1000).toISOString(),
      }));
  },
};

function mockInvoices(): RemoteInvoice[] {
  return [];
}
function mockPayments(): RemotePayment[] {
  return [];
}
