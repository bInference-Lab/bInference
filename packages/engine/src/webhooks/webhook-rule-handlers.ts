import { err, ok } from "@binference/core";
import type { WebhookRuleView } from "@binference/protocol";
import { answererOf, type EngineHandler, proposerOf } from "../operations/engine-call.js";
import { deleteWebhookRule, rotateWebhookUrl } from "./change-webhook-rule.js";
import { createWebhookRule } from "./create-webhook-rule.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";
import type { WebhookRuleRecord } from "./webhook-rule-record.js";

/** The handlers of the webhook rule operations the engine serves (protocol spec, section 7.5). */
export interface WebhookRuleHandlers {
  readonly "webhookRule/create": EngineHandler<"webhookRule/create">;
  readonly "webhookRule/list": EngineHandler<"webhookRule/list">;
  readonly "webhookRule/delete": EngineHandler<"webhookRule/delete">;
  readonly "webhookRule/rotateUrl": EngineHandler<"webhookRule/rotateUrl">;
}

// A rule as clients see it: never its secret or its hash (decision 0299).
function webhookRuleViewOf(rule: WebhookRuleRecord): WebhookRuleView {
  return {
    rule: rule.id,
    agent: rule.agentId,
    state: rule.state,
    request: rule.request,
    fills: rule.fills,
    createdAt: rule.createdAtMs,
    changedAt: rule.changedAtMs,
    ratePerMinute: rule.ratePerMinute,
    ...(rule.lastAlertAtMs === undefined ? {} : { lastAlertAt: rule.lastAlertAtMs }),
  };
}

// Every agent holds 20 rules at most, so one page holds every rule of 50 agents.
const pageLimit = 1_000;

/**
 * Creates the webhook rule handlers (decisions 0053 and 0299): `webhookRule/create` stores a rule
 * awaiting its one card, for the owner's surfaces only, and answers its URL this once;
 * `webhookRule/list` answers every rule active or awaiting its card, oldest first, without its
 * secret; `webhookRule/delete` and `webhookRule/rotateUrl` brake at once, with no card.
 */
export function createWebhookRuleHandlers(parts: WebhookRuleParts): WebhookRuleHandlers {
  return {
    async "webhookRule/create"({ args, caller, signal }) {
      const proposer = proposerOf(caller);
      if (proposer?.role !== "owner") {
        return err("auth.scope");
      }
      const created = await createWebhookRule(parts, { request: args, proposer, signal });
      return created.ok ? ok({ rule: created.value.rule.id, url: created.value.url }) : created;
    },
    async "webhookRule/list"({ signal }) {
      const states = ["awaiting_confirmation", "active"] as const;
      const rules = await parts.rules.list({ states, limit: pageLimit }, { signal });
      return ok({ items: rules.map(webhookRuleViewOf) });
    },
    async "webhookRule/delete"({ args, signal }) {
      const deleted = await deleteWebhookRule(parts, { rule: args.rule, signal });
      return deleted.ok ? ok({}) : deleted;
    },
    async "webhookRule/rotateUrl"({ args, caller, signal }) {
      const by = answererOf(caller);
      const rotated = await rotateWebhookUrl(parts, { rule: args.rule, by, signal });
      return rotated.ok ? ok({ url: rotated.value }) : rotated;
    },
  };
}
