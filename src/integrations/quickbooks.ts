import { IntegrationAdapter } from "./types";

/**
 * QuickBooks Online adapter.
 *
 * Real integration uses OAuth2 (Intuit Developer). Credentials here would
 * be { accessToken, refreshToken, realmId }, refreshed via
 * https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer.
 * Invoices: GET https://quickbooks.api.intuit.com/v3/company/{realmId}/query?query=SELECT * FROM Invoice
 * Payments: GET .../query?query=SELECT * FROM Payment
 *
 * Left as a stub (returns empty in demo mode) until real credentials are
 * supplied — this repo intentionally ships with zero live vendor calls
 * baked in so nothing accidentally talks to a real account.
 */
export const quickbooksAdapter: IntegrationAdapter = {
  provider: "quickbooks",

  async connect(credentials) {
    if (!credentials.accessToken || !credentials.realmId) {
      return { ok: false, error: "Missing accessToken or realmId" };
    }
    // TODO: verify token against QuickBooks CompanyInfo endpoint.
    return { ok: true };
  },

  async fetchInvoices() {
    // TODO: call QuickBooks Invoice query API and map to RemoteInvoice[].
    return [];
  },

  async fetchPayments() {
    // TODO: call QuickBooks Payment query API and map to RemotePayment[].
    return [];
  },
};
