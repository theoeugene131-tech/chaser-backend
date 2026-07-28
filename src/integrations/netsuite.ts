import { IntegrationAdapter } from "./types";

/**
 * NetSuite adapter.
 *
 * Real integration typically goes through NetSuite's SuiteTalk REST API
 * (token-based auth, OAuth1 TBA) or a SuiteQL query against the
 * `transaction` table filtered to invoices. Credentials would be
 * { accountId, consumerKey, consumerSecret, tokenId, tokenSecret }.
 */
export const netsuiteAdapter: IntegrationAdapter = {
  provider: "netsuite",

  async connect(credentials) {
    if (!credentials.accountId || !credentials.tokenId) {
      return { ok: false, error: "Missing accountId or tokenId" };
    }
    // TODO: sign a request with OAuth1 TBA and hit /record/v1/invoice?limit=1
    return { ok: true };
  },

  async fetchInvoices() {
    // TODO: SuiteQL query mapped to RemoteInvoice[].
    return [];
  },

  async fetchPayments() {
    // TODO: SuiteQL query against customerpayment records.
    return [];
  },
};
