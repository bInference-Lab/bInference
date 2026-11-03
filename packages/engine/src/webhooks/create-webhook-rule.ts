import { type BinferenceErrorOptions, err, type Id, ok, type Result } from "@binference/core";
import type { AssetInfos, ProtocolErrorCode, WebhookRuleRequest } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { Proposer } from "../money-path/create-money-path.js";
import { unlistedAssetInfos } from "../money-path/token-facts.js";
import { agentRefusal } from "../orders/create-order.js";
import { openOneCard, storedUnlessTaken } from "../orders/open-one-card.js";
import { checkFillBounds, defaultOrderLifetimeMs } from "../orders/order-rules.js";
import { orderWalletOf } from "../orders/order-wallet-of.js";
import type { WebhookRuleParts } from "./webhook-rule-parts.js";
import { webhookRuleQuoteDocument } from "./webhook-rule-quote.js";
import type { WebhookRuleDraft, WebhookRuleRecord } from "./webhook-rule-record.js";
import { newWebhookSecret, webhookUrlOf } from "./webhook-secret.js";

/** A new rule, the `webhookRule` intent that carries its one card, and its URL, shown this once. */
export interface CreatedWebhookRule {
  readonly rule: WebhookRuleRecord;
  readonly intent: IntentSnapshot;
  readonly url: string;
}

// A rule accepts one alert a minute unless it names its rate (decision 0299).
const defaultRatePerMinute = 1;

// The rule's agent, which takes rules: stored, in use, not frozen, and in paper mode, since live
// webhook fills are not built yet, so no live rule is taken (decisions 0299 and 0338).
async function agentRefusalOf(
  parts: WebhookRuleParts,
  agent: WebhookRuleRequest["agent"],
  signal: AbortSignal,
): Promise<ProtocolErrorCode | undefined> {
  const settings = await parts.agents.get(agent, { signal });
  const refusal = agentRefusal(settings);
  if (refusal !== undefined) {
    return refusal;
  }
  return settings?.agent.mode === "live" ? "order.live_fills_off" : undefined;
}

/** A checked request's wallet, canonical token and spend, and what its unlisted tokens answered. */
interface Placed {
  readonly wallet: Id<"wal">;
  readonly token: WebhookRuleRequest["token"];
  readonly spend?: WebhookRuleRequest["token"];
  readonly assets: AssetInfos;
}

// The wallet that holds the rule, as an order's, and the info of its tokens for its card.
async function placedOf(
  parts: WebhookRuleParts,
  request: WebhookRuleRequest,
  signal: AbortSignal,
): Promise<Result<Placed, ProtocolErrorCode>> {
  const bounds = checkFillBounds(request, { nowMs: parts.clock.now(), chains: parts.chains });
  if (!bounds.ok) {
    return bounds;
  }
  const { token, spend, chain } = bounds.value;
  const refusal = await agentRefusalOf(parts, request.agent, signal);
  if (refusal !== undefined) {
    return err(refusal);
  }
  const asked = { request: { ...request, token }, chain, isPaper: true };
  const wallet = await orderWalletOf(parts, asked, signal);
  if (!wallet.ok) {
    return wallet;
  }
  const named = spend === undefined ? [token] : [token, spend];
  const assets = await unlistedAssetInfos(parts, named, signal);
  if (!assets.ok) {
    return assets;
  }
  const spent = spend === undefined ? {} : { spend };
  return ok({ wallet: wallet.value, token, ...spent, assets: assets.value });
}

// The rule as it is stored, its defaults filled: its wallet, expiry and rate in its request too.
function draftOf(
  parts: WebhookRuleParts,
  request: WebhookRuleRequest,
  placed: Placed,
): Omit<WebhookRuleDraft, "secretHash"> {
  const atMs = parts.clock.now();
  const expiresAtMs = request.expiresAt ?? atMs + defaultOrderLifetimeMs;
  const ratePerMinute = request.ratePerMinute ?? defaultRatePerMinute;
  const { wallet, token, spend } = placed;
  const filled = {
    ...request,
    wallet,
    token,
    ...(spend === undefined ? {} : { spend }),
    expiresAt: expiresAtMs,
    ratePerMinute,
  };
  return {
    id: parts.ids.next("whr"),
    agentId: request.agent,
    walletId: wallet,
    request: filled,
    ratePerMinute,
    ...(request.maxFills === undefined ? {} : { maxFills: request.maxFills }),
    expiresAtMs,
    intentId: parts.ids.next("int"),
    isPaper: true,
    atMs,
  };
}

// Stores the rule's `webhookRule` intent and takes it to its one card: its quote holds the rule's
// terms, so the card's terms hash binds them, and it never passes the auto test (decision 0299).
async function openRuleCard(
  parts: WebhookRuleParts,
  opening: {
    readonly rule: WebhookRuleRecord;
    readonly assets: AssetInfos;
    readonly proposer: Proposer;
  },
  signal: AbortSignal,
): Promise<IntentSnapshot> {
  const { rule, assets, proposer } = opening;
  const quoteAt = (quotedAtMs: number) =>
    webhookRuleQuoteDocument.encode({
      rule: rule.id,
      request: rule.request,
      ratePerMinute: rule.ratePerMinute,
      expiresAtMs: rule.expiresAtMs,
      ...(rule.maxFills === undefined ? {} : { maxFills: rule.maxFills }),
      isPaper: rule.isPaper,
      quotedAtMs,
    });
  const notStored: BinferenceErrorOptions = {
    code: "engine.rule_not_stored",
    message: `The card of webhook rule ${rule.id} could not be stored.`,
    details: { rule: rule.id },
  };
  const record = { ...rule, hasOutsideContent: false };
  const request = { kind: "webhookRule", rule: rule.id } as const;
  return openOneCard(parts, { record, request, proposer, assets, quoteAt, notStored }, signal);
}

// A stored rule, or why the store refused it: a frozen agent, or a 21st rule. An id in use is a
// fault.
function storedRule(
  created: Result<WebhookRuleRecord, "exists" | "frozen" | "too_many">,
  id: Id<"whr">,
): Result<WebhookRuleRecord, ProtocolErrorCode> {
  const stored = storedUnlessTaken(created, {
    code: "engine.rule_not_stored",
    message: `A new webhook rule's id ${id} is taken.`,
    details: { rule: id },
  });
  return stored.ok ? stored : err(stored.error === "frozen" ? "agent.frozen" : "webhook.too_many");
}

/**
 * Creates a webhook rule (decisions 0053, 0299 and 0337): checks its bounds as `order/create`
 * checks a buy or sell order of the same token and fills its defaults (30 days, one alert a
 * minute, no fill limit), stores it `awaiting_confirmation` in paper mode with the SHA-256 of a new
 * secret, then its `webhookRule` intent, which always opens one card. The rule is `active` only on
 * that card's Confirm. It answers the rule's URL, which holds the secret, this once. A refusal
 * stores nothing: an unknown, archived or frozen agent, a live agent (`order.live_fills_off`,
 * since live webhook fills are not built), a wallet that is not the agent's, a broken bound, a
 * token that answers no symbol or decimals, or an agent's 21st rule (`webhook.too_many`).
 */
export async function createWebhookRule(
  parts: WebhookRuleParts,
  call: {
    readonly request: WebhookRuleRequest;
    readonly proposer: Proposer;
    readonly signal: AbortSignal;
  },
): Promise<Result<CreatedWebhookRule, ProtocolErrorCode>> {
  const { request, proposer, signal } = call;
  const placed = await placedOf(parts, request, signal);
  if (!placed.ok) {
    return placed;
  }
  const { secret, secretHash } = newWebhookSecret(parts.secretRandom);
  const draft = draftOf(parts, request, placed.value);
  const stored = await parts.rules.create({ ...draft, secretHash }, { signal });
  const created = storedRule(stored, draft.id);
  if (!created.ok) {
    return created;
  }
  const opening = { rule: created.value, assets: placed.value.assets, proposer };
  const intent = await openRuleCard(parts, opening, signal);
  const url = webhookUrlOf(parts.webhookBase(), created.value.id, secret);
  return ok({ rule: created.value, intent, url });
}
