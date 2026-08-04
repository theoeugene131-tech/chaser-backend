import { IntegrationAdapter } from "./types";

/**
 * Bill.com adapter.
 *
 * Real integration uses the Bill.com API v3 (session-based auth via
 * /Login.json, then List/Read calls against Invoice and ReceivedPayment
 * objects). Credentials would be { orgId, devKey, sessionId }.
 */
export const billcomAdapter: IntegrationAdapter = {
  provider: "billcom",

  async connect(credentials) {
    if (!credentials.orgId || !credentials.devKey) {
      return { ok: false, error: "Missing orgId or devKey" };
    }
    // TODO: POST to /Login.json to obtain a sessionId, store it for subsequent calls.
    return { ok: true };
  },

  async fetchInvoices() {
    // TODO: POST /List/Invoice.json, map results to RemoteInvoice[].
    return [];
  },

  async fetchPayments() {
    // TODO: POST /List/ReceivedPayment.json, map results to RemotePayment[].
    return [];
  },
};
