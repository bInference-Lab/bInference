import type { WebhookAlertStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { findRuleTask, pruneWebhookEventsTask, takeAlertTask } from "./webhook-tasks.js";

/**
 * The {@link WebhookAlertStore} on `engine.sqlite`: `webhook_rules` read by id, and each alert
 * judged and recorded in `webhook_events`, with an accepted one's inbox entry, in one write.
 */
export function createSqliteWebhookAlertStore(host: StoreHost): WebhookAlertStore {
  const find = bindTask(host, findRuleTask);
  return {
    findRule: async (id, options) => (await find(id, options)) ?? undefined,
    take: bindTask(host, takeAlertTask),
    prune: bindTask(host, pruneWebhookEventsTask),
  };
}
