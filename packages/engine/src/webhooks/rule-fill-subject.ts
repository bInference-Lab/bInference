import type { BoundedOrder } from "../orders/fill-bounds.js";
import type { FillSubject, FillTerms } from "../orders/fill-subject.js";
import type { WebhookRuleStore } from "./ports.js";
import { isAnswering } from "./webhook-alert.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** The terms each fill of a webhook rule is sized and held to: its bounds alone (decision 0299). */
export function ruleFillTerms(rule: WebhookRuleRecord): FillTerms {
  const { request } = rule;
  return {
    source: rule.id,
    agentId: rule.agentId,
    walletId: rule.walletId,
    isPaper: rule.isPaper,
    token: request.token,
    side: request.side,
    size: request.size,
    ...(request.spend === undefined ? {} : { spend: request.spend }),
    ...(request.maxSlippageBps === undefined ? {} : { maxSlippageBps: request.maxSlippageBps }),
    reason: rule.id,
    isShareSizedNow: false,
  };
}

/** A rule as the bounds check holds a fill to it: active while its URL answers, else ended. */
function boundedOf(rule: WebhookRuleRecord, nowMs: number): BoundedOrder {
  const { request } = rule;
  return {
    state: isAnswering(rule, nowMs) ? "active" : "cancelled",
    fills: rule.fills,
    ...(rule.maxFills === undefined ? {} : { maxFills: rule.maxFills }),
    expiresAtMs: rule.expiresAtMs,
    request: {
      side: request.side,
      ...(request.worstPrice === undefined ? {} : { worstPrice: request.worstPrice }),
      ...(request.maxSlippageBps === undefined ? {} : { maxSlippageBps: request.maxSlippageBps }),
    },
  };
}

/**
 * A webhook rule's fill, held to the rule as it stands while it keeps the fills it had when the
 * fill was sized: a fill it counted since, or a new URL, leaves this one nothing to fill
 * (decisions 0337 and 0338).
 */
export function ruleFillSubject(
  parts: { readonly rules: Pick<WebhookRuleStore, "get">; readonly now: () => number },
  rule: WebhookRuleRecord,
): FillSubject {
  return {
    terms: ruleFillTerms(rule),
    current: async (signal) => {
      const now = await parts.rules.get(rule.id, { signal });
      const isSameUrl =
        now?.urlChangedAtMs === rule.urlChangedAtMs && now.oldUrlLastEvent === rule.oldUrlLastEvent;
      const isSame = isSameUrl && now.fills === rule.fills;
      return isSame ? boundedOf(now, parts.now()) : undefined;
    },
    isOverSize: () => false,
  };
}
