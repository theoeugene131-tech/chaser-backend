import { IntegrationAdapter } from "./types";

/**
 * Coupa adapter.
 *
 * Coupa is a supplier portal, not a source of truth for your own invoices —
 * its main job here is (a) uploading invoices/reminders into the buyer's
 * portal and (b) polling for uploaded remittance/payment documents, which
 * is the "customer uploaded a payment doc to Coupa" scenario from the
 * product pitch. Real integration uses the Coupa Supplier Portal API
 * (OAuth2 client-credentials), typically the /invoices and /payments
 * endpoints scoped to your supplier account.
 */
export const coupaAdapter: IntegrationAdapter = {
  provider: "coupa",

  async connect(credentials) {
    if (!credentials.clientId || !credentials.clientSecret) {
      return { ok: false, error: "Missing clientId or clientSecret" };
    }
    // TODO: OAuth2 client_credentials grant against {instance}.coupahost.com/oauth2/token
    return { ok: true };
  },

  async fetchInvoices() {
    return [];
  },

  async fetchPayments() {
    // TODO: poll /payments (or a webhook, if the buyer's Coupa instance supports one)
    // for newly uploaded remittance documents — this is what feeds the matching engine.
    return [];
  },

  async sendReminder(_credentials, invoiceExternalId, message) {
    // TODO: POST a comment/notice on the invoice record in the supplier portal.
    console.log(`[coupa] would post reminder on ${invoiceExternalId}: ${message}`);
  },
};
