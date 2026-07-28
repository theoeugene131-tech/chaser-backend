import { IntegrationProvider } from "../types";

export interface RemoteInvoice {
  externalId: string;
  customerExternalId: string;
  customerName: string;
  customerEmail: string;
  number: string;
  amountCents: number;
  currency: string;
  dueDate: string;
  issuedDate: string;
}

export interface RemotePayment {
  externalRef: string;
  customerExternalId: string;
  amountCents: number;
  currency: string;
  receivedAt: string;
}

/**
 * Every provider (Stripe, QuickBooks, NetSuite, Bill.com, Coupa, Ariba...)
 * implements this same interface. Routes and services never talk to a
 * vendor SDK directly — they call these three methods. That's what makes
 * "plug into your stack" actually true: adding a provider means writing
 * one adapter file, not touching business logic.
 */
export interface IntegrationAdapter {
  provider: IntegrationProvider;

  /** Verify credentials / complete OAuth exchange. */
  connect(credentials: Record<string, string>): Promise<{ ok: boolean; error?: string }>;

  /** Pull open invoices since a given point (or full sync if omitted). */
  fetchInvoices(credentials: Record<string, string>, since?: string): Promise<RemoteInvoice[]>;

  /** Pull payments / remittance records since a given point. */
  fetchPayments(credentials: Record<string, string>, since?: string): Promise<RemotePayment[]>;

  /** Push a reminder or notice into the provider's channel, if it supports one (e.g. a supplier portal). */
  sendReminder?(credentials: Record<string, string>, invoiceExternalId: string, message: string): Promise<void>;
}
