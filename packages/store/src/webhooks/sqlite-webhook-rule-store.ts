import type { WebhookRuleStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  alertsTask,
  alertTask,
  createRuleTask,
  endAlertTask,
  getRuleTask,
  listRulesTask,
  markAlertsAnnouncedTask,
  moveRuleTask,
  ruleByIntentTask,
  unannouncedAlertsTask,
} from "./webhook-rule-tasks.js";

/**
 * The {@link WebhookRuleStore} on `engine.sqlite`: `webhook_rules`, the same rows the listener
 * reads, and each accepted alert's end on its `webhook_events` row. A move into `active` reads the
 * card's confirmation and the agent in its own transaction; a fill's end is written with its
 * intent's move (`intent-writes.ts`).
 */
export function createSqliteWebhookRuleStore(host: StoreHost): WebhookRuleStore {
  return {
    create: bindTask(host, createRuleTask),
    get: async (id, options) => (await bindTask(host, getRuleTask)(id, options)) ?? undefined,
    byIntent: async (intent, options) =>
      (await bindTask(host, ruleByIntentTask)(intent, options)) ?? undefined,
    list: bindTask(host, listRulesTask),
    move: bindTask(host, moveRuleTask),
    alert: async (event, options) => (await bindTask(host, alertTask)(event, options)) ?? undefined,
    alerts: bindTask(host, alertsTask),
    endAlert: bindTask(host, endAlertTask),
    unannounced: bindTask(host, unannouncedAlertsTask),
    markAnnounced: bindTask(host, markAlertsAnnouncedTask),
  };
}
