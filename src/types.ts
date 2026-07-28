export type EventType = "reminder" | "matched" | "escalated" | "paid";

export type InvoiceStatus = "current" | "reminder" | "matched" | "escalated" | "paid" | "disputed";

export interface Organization {
  id: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  passwordHash: string;
  name: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  orgId: string;
  name: string;
  email: string;
  externalIds: Partial<Record<IntegrationProvider, string>>;
  createdAt: string;
}

export interface Invoice {
  id: string;
  orgId: string;
  customerId: string;
  number: string;
  amountCents: number;
  amountPaidCents: number;
  currency: string;
  dueDate: string;
  issuedDate: string;
  status: InvoiceStatus;
  source: IntegrationProvider;
  externalId: string | null;
  lastReminderAt: string | null;
  reminderCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  orgId: string;
  customerId: string;
  invoiceId: string | null; // null until matched
  amountCents: number;
  currency: string;
  receivedAt: string;
  source: IntegrationProvider;
  externalRef: string | null;
  matched: boolean;
  createdAt: string;
}

export type IntegrationProvider = "stripe" | "quickbooks" | "netsuite" | "billcom" | "coupa" | "ariba";

export interface IntegrationConnection {
  id: string;
  orgId: string;
  provider: IntegrationProvider;
  connected: boolean;
  // Real deployments store encrypted OAuth tokens / API keys here.
  credentials: Record<string, string> | null;
  lastSyncedAt: string | null;
}

export interface InboxEvent {
  id: string;
  orgId: string;
  type: EventType;
  customerId: string;
  invoiceId: string | null;
  detail: string;
  createdAt: string;
}

export interface EscalationRule {
  id: string;
  orgId: string;
  daysPastDue: number;
  action: "reminder" | "escalate";
  channel: "email" | "portal" | "human";
}
