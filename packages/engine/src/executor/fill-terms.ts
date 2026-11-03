import {
  accountRefSchema,
  type ChainRegistry,
  assetRefParts,
  checkFillGrant,
  fillGrantLifetimeMs,
  type FillGrant,
  type FillSourceNow,
  type SignAuthorization,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { OrderAuthorization } from "../intents/authorization.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { authorizationDocument, quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { fillTermsHash } from "../orders/fill-terms-hash.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import type { IntentStore } from "../ports.js";
import {
  ruleBindingOf,
  type RuleFillTermsParts,
  ruleNowFor,
  type SourceBinding,
} from "./rule-fill-terms.js";

/**
 * What a fill's terms read: its order or rule, the source's confirmation, whether a rule's agent
 * is frozen, the chains and the time.
 */
export interface FillTermsParts extends RuleFillTermsParts {
  readonly chains: ChainRegistry;
  readonly orders: Pick<OrderStore, "get">;
  readonly intents: Pick<IntentStore, "confirmation">;
  readonly clock: Clock;
}

// What a fill spends and the most of it, its confirmed quote's input: the chain's coin, or a token
// by its contract. `undefined` on a chain the registry does not list, which no grant covers.
function spendOf(parts: FillTermsParts, record: IntentRecord): FillGrant["spend"] | undefined {
  const quote = quoteDocument.decode(record.quote ?? null);
  const { asset, base } = quote.amountIn;
  const { chain, assetReference } = assetRefParts(asset);
  const registered = parts.chains.get(chain);
  if (!registered.ok) {
    return undefined;
  }
  return asset === nativeAssetOf(registered.value)
    ? { maxBase: base }
    : { token: accountRefSchema.parse(`${chain}:${assetReference}`), maxBase: base };
}

/** The order as the signer reads it: its state, confirmed terms, expiry and fills now. */
function orderNowOf(order: OrderRecord, orderTermsHash: string): FillSourceNow {
  return {
    id: order.id,
    state: order.state,
    termsHash: orderTermsHash,
    expiresAtMs: order.expiresAtMs,
    fills: order.fills,
    ...(order.maxFills === undefined ? {} : { maxFills: order.maxFills }),
  };
}

// The order of a live order fill, with the terms hash of its confirmed card; `undefined` when it
// names no fills before it, or its order or card is gone.
async function orderBindingOf(
  parts: FillTermsParts,
  call: {
    readonly snapshot: IntentSnapshot;
    readonly fill: OrderAuthorization;
    readonly signal: AbortSignal;
  },
): Promise<SourceBinding | undefined> {
  const { snapshot, fill, signal } = call;
  const order = await parts.orders.get(fill.order, { signal });
  const card =
    order === undefined ? undefined : await parts.intents.confirmation(order.intentId, { signal });
  const { fillsBefore } = fill;
  if (order === undefined || card === undefined || fillsBefore === undefined) {
    return undefined;
  }
  const sourceTermsHash = card.termsHash;
  const binding = { order: order.id, orderTermsHash: sourceTermsHash, fillsBefore };
  // The fill as it reads now hashes to what its confirmation stored, or nothing signs it.
  const termsHash = fillTermsHash(snapshot.record, binding);
  return termsHash === fill.termsHash
    ? { current: orderNowOf(order, sourceTermsHash), sourceTermsHash, fillsBefore, termsHash }
    : undefined;
}

// The order or rule a live fill fills, with the terms hash of its confirmed card; `undefined` when
// the intent is no live fill, or its source no longer binds it.
async function bindingOf(
  parts: FillTermsParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<SourceBinding | undefined> {
  const { authorizedBy } = snapshot.stored.status;
  const { record } = snapshot;
  if (record.isPaper || authorizedBy === undefined || record.quote === undefined) {
    return undefined;
  }
  if ("order" in authorizedBy) {
    return orderBindingOf(parts, { snapshot, fill: authorizedBy, signal });
  }
  return "webhookRule" in authorizedBy
    ? ruleBindingOf(parts, { snapshot, fill: authorizedBy, signal })
    : undefined;
}

/**
 * The fill grant of a confirmed live fill of an order or a rule (decisions 0210 and 0342): granted
 * when the fill moved to `confirmed`, for a trade card's lifetime, up to the chain's network fee
 * cap, for at most what its confirmed quote spends, bound to its source's confirmed terms and the
 * fills its source had before it. `undefined` for any other intent.
 */
export async function fillGrantOf(
  parts: FillTermsParts,
  snapshot: IntentSnapshot,
  call: { readonly networkFeeCapNativeBase: bigint; readonly signal: AbortSignal },
): Promise<{ readonly grant: FillGrant; readonly current: FillSourceNow } | undefined> {
  const { record, history } = snapshot;
  const confirmed = history.events.find((event) => event.toState === "confirmed");
  const binding = await bindingOf(parts, snapshot, call.signal);
  const spend = binding === undefined ? undefined : spendOf(parts, record);
  if (confirmed === undefined || binding === undefined || spend === undefined) {
    return undefined;
  }
  const grant: FillGrant = {
    source: binding.current.id,
    agent: record.agentId,
    intent: record.id,
    sourceTermsHash: binding.sourceTermsHash,
    fillsBefore: binding.fillsBefore,
    termsHash: binding.termsHash,
    grantedAtMs: confirmed.atMs,
    expiresAtMs: confirmed.atMs + fillGrantLifetimeMs,
    networkFeeCapNativeBase: call.networkFeeCapNativeBase,
    spend,
  };
  return { grant, current: binding.current };
}

// A fill grant against its order now, as the signer checks it, for a step that spends what the
// grant allows: the signer holds each step's own spend to it.
function grantCheck(
  grant: FillGrant,
  current: FillSourceNow,
  at: { readonly nowMs: number; readonly stepIndex: number },
) {
  const { nowMs, stepIndex } = at;
  const { token, maxBase } = grant.spend;
  const action = { kind: "call", nativeValue: token === undefined ? maxBase : 0n } as const;
  const check = {
    intent: grant.intent,
    termsHash: grant.termsHash,
    source: current,
    action,
    isCancel: false,
    stepIndex,
    nowMs,
  };
  return checkFillGrant(grant, check);
}

/**
 * Whether a fill grant still holds against its order now for the step at `stepIndex`, as the
 * signer checks it: a later step also while a freeze pauses the order (decision 0211).
 */
export function fillGrantHolds(
  grant: FillGrant,
  current: FillSourceNow,
  at: { readonly nowMs: number; readonly stepIndex: number },
): SignAuthorization | undefined {
  return grantCheck(grant, current, at).ok ? { kind: "fill", grant, current } : undefined;
}

/** What the queue reads of a live fill as it takes it: what signs it, or why it ends at once. */
export interface FillQueueCheck {
  readonly terms?: { readonly authorization: SignAuthorization; readonly termsHash: string };
  /** Why the fill ends now, unsigned (decision 0211); absent while it may wait for its turn. */
  readonly refusal?: OrderFillReason;
}

// Why the queue ends a fill before its grant: live fills off, the agent no longer live, or the
// policy refusing it now, by its reason.
function earlyRefusal(facts: {
  readonly liveFills: boolean;
  readonly isAgentLive: boolean;
  readonly policyReason?: OrderFillReason;
}): OrderFillReason | undefined {
  if (!facts.liveFills) {
    return "live_fills_off";
  }
  return facts.isAgentLive ? facts.policyReason : "paper_only";
}

// Why a source no longer holds its fill's grant: a rule its owner rotated or its agent's freeze
// paused (decision 0342), or an order or rule that ended.
function inactiveReasonOf(current: FillSourceNow): OrderFillReason {
  if (current.state === "url_rotated") {
    return "url_rotated";
  }
  return current.state === "paused" ? "frozen" : "order_inactive";
}

/**
 * The queue's check of a confirmed live fill (decisions 0210 and 0211): its grant's terms while
 * its order holds them, or the reason it ends at once, so its agent's line is free and the owner
 * hears the cause: live fills off, the agent not live, the policy refusing it, or its order no
 * longer holding the grant. A grant that only ran out lapses as any authorization does.
 */
export async function checkFillForQueue(
  parts: FillTermsParts,
  snapshot: IntentSnapshot,
  call: {
    readonly liveFills: boolean;
    readonly isAgentLive: boolean;
    readonly policyReason?: OrderFillReason;
    readonly networkFeeCapNativeBase?: bigint;
    readonly signal: AbortSignal;
  },
): Promise<FillQueueCheck> {
  const early = earlyRefusal(call);
  const cap = call.networkFeeCapNativeBase;
  if (early !== undefined || cap === undefined) {
    return early === undefined ? {} : { refusal: early };
  }
  const made = await fillGrantOf(parts, snapshot, {
    networkFeeCapNativeBase: cap,
    signal: call.signal,
  });
  if (made === undefined) {
    return { refusal: "fill_failed" };
  }
  const checked = grantCheck(made.grant, made.current, { nowMs: parts.clock.now(), stepIndex: 0 });
  if (!checked.ok) {
    return checked.error === "expired" ? {} : { refusal: inactiveReasonOf(made.current) };
  }
  const authorization = { kind: "fill", grant: made.grant, current: made.current } as const;
  return { terms: { authorization, termsHash: made.grant.termsHash } };
}

/**
 * The source now of a live fill's grant, read again right before one more signature: its order's
 * or rule's state, expiry and fills as they stand, with its confirmed card's terms hash, a rule's
 * read for the fill's alert (decision 0342). `undefined` once the source or its card is gone.
 */
export async function sourceNowFor(
  parts: FillTermsParts,
  record: Pick<IntentRecord, "authorizedBy">,
  signal: AbortSignal,
): Promise<FillSourceNow | undefined> {
  const fill =
    record.authorizedBy === undefined
      ? undefined
      : authorizationDocument.decode(record.authorizedBy);
  if (fill !== undefined && "webhookRule" in fill) {
    return ruleNowFor(parts, fill, signal);
  }
  const order =
    fill !== undefined && "order" in fill
      ? await parts.orders.get(fill.order, { signal })
      : undefined;
  const card =
    order === undefined ? undefined : await parts.intents.confirmation(order.intentId, { signal });
  return order === undefined || card === undefined ? undefined : orderNowOf(order, card.termsHash);
}
