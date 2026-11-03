import type { InboxStore } from "../ingress/ports.js";
import {
  createMemoryWebhookAlertStore,
  type MemoryWebhookAlertStore,
} from "./memory-webhook-alert-store.js";
import {
  createMemoryWebhookRuleStore,
  type MemoryWebhookRuleStore,
  type MemoryWebhookRuleStoreOptions,
} from "./memory-webhook-rule-store.js";

/** The two in-memory webhook stores of one database: the listener's and the rules'. */
export interface MemoryWebhookStores {
  readonly webhookAlerts: MemoryWebhookAlertStore;
  readonly webhookRules: MemoryWebhookRuleStore;
}

/**
 * Creates the in-memory webhook alert store, whose accepted alerts go into `inbox`, and the rule
 * store beside it, which plants its rules there and reads its alerts.
 */
export function createMemoryWebhookStores(
  options: Omit<MemoryWebhookRuleStoreOptions, "alerts"> & { readonly inbox: InboxStore },
): MemoryWebhookStores {
  const { inbox, ...rest } = options;
  const webhookAlerts = createMemoryWebhookAlertStore({ inbox });
  return {
    webhookAlerts,
    webhookRules: createMemoryWebhookRuleStore({ ...rest, alerts: webhookAlerts }),
  };
}
