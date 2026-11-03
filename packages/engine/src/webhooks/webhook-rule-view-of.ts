import type { ChainRegistry } from "@binference/chain";
import type { WebhookEventView, WebhookRuleView } from "@binference/protocol";
import { webhookRuleSummary } from "../confirmations/webhook-rule-card-lines.js";
import { webhookRuleActionOf } from "../surfaces/webhook-rule-card-facts.js";
import type { WebhookEventRecord } from "./webhook-event-record.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/**
 * A rule as clients see it, never its secret or its hash (decision 0299): with the intent of its
 * card and what each alert trades as its card words it, unless its token's chain left the
 * registry, when no card line can be drawn.
 */
export function webhookRuleViewOf(rule: WebhookRuleRecord, chains: ChainRegistry): WebhookRuleView {
  const { request, ratePerMinute, expiresAtMs, maxFills } = rule;
  const quote = {
    rule: rule.id,
    request,
    ratePerMinute,
    expiresAtMs,
    ...(maxFills === undefined ? {} : { maxFills }),
    isPaper: rule.isPaper,
    quotedAtMs: rule.createdAtMs,
  };
  const action = webhookRuleActionOf(quote, chains);
  return {
    rule: rule.id,
    agent: rule.agentId,
    state: rule.state,
    request,
    fills: rule.fills,
    createdAt: rule.createdAtMs,
    changedAt: rule.changedAtMs,
    ratePerMinute,
    ...(rule.lastAlertAtMs === undefined ? {} : { lastAlertAt: rule.lastAlertAtMs }),
    intent: rule.intentId,
    ...(action === undefined ? {} : { summary: webhookRuleSummary(action) }),
  };
}

/** What one alert became, as clients see it: never its body. */
export function webhookEventViewOf(record: WebhookEventRecord): WebhookEventView {
  const { alertId, outcome, reason, intentId } = record;
  return {
    event: record.event,
    receivedAt: record.receivedAtMs,
    taken: record.taken,
    ...(alertId === undefined ? {} : { alertId }),
    ...(outcome === undefined ? {} : { fill: outcome }),
    ...(reason === undefined ? {} : { reason }),
    ...(intentId === undefined ? {} : { intent: intentId }),
  };
}
