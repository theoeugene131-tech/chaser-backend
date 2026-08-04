import { IntegrationProvider } from "../types";
import { IntegrationAdapter } from "./types";
import { stripeAdapter } from "./stripe";
import { quickbooksAdapter } from "./quickbooks";
import { netsuiteAdapter } from "./netsuite";
import { billcomAdapter } from "./billcom";
import { coupaAdapter } from "./coupa";

export const adapters: Record<string, IntegrationAdapter> = {
  stripe: stripeAdapter,
  quickbooks: quickbooksAdapter,
  netsuite: netsuiteAdapter,
  billcom: billcomAdapter,
  coupa: coupaAdapter,
};

export function getAdapter(provider: IntegrationProvider): IntegrationAdapter | null {
  return adapters[provider] ?? null;
}

export const SUPPORTED_PROVIDERS: IntegrationProvider[] = [
  "stripe",
  "quickbooks",
  "netsuite",
  "billcom",
  "coupa",
];
