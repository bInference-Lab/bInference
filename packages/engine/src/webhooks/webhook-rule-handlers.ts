import { err, ok } from "@binference/core";
import { z } from "zod";
import { knownAssetInfos } from "../money-path/asset-infos.js";
import {
  answererOf,
  type EngineCall,
  type EngineHandler,
  proposerOf,
} from "../operations/engine-call.js";
import { deleteWebhookRule, rotateWebhookUrl } from "./change-webhook-rule.js";
import { createWebhookRule } from "./create-webhook-rule.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";
import { webhookEventViewOf, webhookRuleViewOf } from "./webhook-rule-view-of.js";

/** The handlers of the webhook rule operations the engine serves (protocol spec, section 7.5). */
export interface WebhookRuleHandlers {
  readonly "webhookRule/create": EngineHandler<"webhookRule/create">;
  readonly "webhookRule/list": EngineHandler<"webhookRule/list">;
  readonly "webhookRule/events": EngineHandler<"webhookRule/events">;
  readonly "webhookRule/delete": EngineHandler<"webhookRule/delete">;
  readonly "webhookRule/rotateUrl": EngineHandler<"webhookRule/rotateUrl">;
}

// Every agent holds 20 rules at most, so one page holds every rule of 50 agents.
const pageLimit = 1_000;
const defaultEventPage = 50;

// A cursor is the row of the last alert of the page before, in decimal.
const cursorSchema: z.ZodType<number, string> = z
  .string()
  .regex(/^[1-9]\d{0,14}$/)
  .pipe(z.coerce.number<string>());

async function listed(parts: WebhookRuleParts, signal: AbortSignal) {
  const states = ["awaiting_confirmation", "active"] as const;
  const rules = await parts.rules.list({ states, limit: pageLimit }, { signal });
  const assets = rules.flatMap(({ request }) =>
    request.spend === undefined ? [request.token] : [request.token, request.spend],
  );
  return ok({
    items: rules.map((rule) => webhookRuleViewOf(rule, parts.chains)),
    assets: await knownAssetInfos(parts, [...new Set(assets)], { signal }),
  });
}

async function eventsOf(parts: WebhookRuleParts, call: EngineCall<"webhookRule/events">) {
  const { args, signal } = call;
  const before = args.cursor === undefined ? undefined : cursorSchema.safeParse(args.cursor);
  if (before?.success === false) {
    return err("protocol.bad_args");
  }
  const limit = args.limit ?? defaultEventPage;
  const query = {
    ruleId: args.rule,
    limit,
    ...(before === undefined ? {} : { before: before.data }),
  };
  const records = await parts.rules.events(query, { signal });
  const last = records.at(-1);
  const items = records.map(webhookEventViewOf);
  return ok(
    records.length === limit && last !== undefined
      ? { items, next: String(last.event) }
      : { items },
  );
}

/**
 * Creates the webhook rule handlers (decisions 0053 and 0299): `webhookRule/create` stores a rule
 * awaiting its one card, for the owner's surfaces only, and answers its URL this once;
 * `webhookRule/list` answers every rule active or awaiting its card, oldest first, without its
 * secret, with the info of each token they trade or spend; `webhookRule/events` pages through what
 * each alert to one rule's URL became, the newest first; `webhookRule/delete` and
 * `webhookRule/rotateUrl` brake at once, with no card.
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
    "webhookRule/list": async ({ signal }) => listed(parts, signal),
    "webhookRule/events": async (call) => eventsOf(parts, call),
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
