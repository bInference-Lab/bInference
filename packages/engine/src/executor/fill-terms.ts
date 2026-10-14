import {
  accountRefSchema,
  type ChainRegistry,
  assetRefParts,
  checkFillGrant,
  fillGrantLifetimeMs,
  type FillGrant,
  type OrderNow,
  type SignAuthorization,
} from "@binference/chain";
import type { Clock } from "@binference/core";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import { fillTermsHash } from "../orders/fill-terms-hash.js";
import type { OrderFillReason } from "../orders/order-fill.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import type { IntentStore } from "../ports.js";

/** What a fill's terms read: its order, the order's confirmation, the chains and the time. */
export interface FillTermsParts {
  readonly chains: ChainRegistry;
  readonly orders: Pick<OrderStore, "get">;
  readonly intents: Pick<IntentStore, "confirmation">;
  readonly clock: Clock;
}

/** What binds a fill to its order: the order, its confirmed terms and its fills before the fill. */
interface FillBinding {
  readonly order: OrderRecord;
  readonly orderTermsHash: string;
  readonly fillsBefore: number;
  /** The fill's terms hash, as its confirmation stored it and its record hashes again. */
  readonly termsHash: string;
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
function orderNowOf(order: OrderRecord, orderTermsHash: string): OrderNow {
  return {
    id: order.id,
    state: order.state,
    termsHash: orderTermsHash,
    expiresAtMs: order.expiresAtMs,
    fills: order.fills,
    ...(order.maxFills === undefined ? {} : { maxFills: order.maxFills }),
  };
}

// The order a live fill fills, with the terms hash of its confirmed card; `undefined` when the
// intent is no live order fill, names no fills before it, or its order or card is gone.
async function bindingOf(
  parts: FillTermsParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<FillBinding | undefined> {
  const { authorizedBy } = snapshot.stored.status;
  const { record } = snapshot;
  if (
    record.isPaper ||
    authorizedBy === undefined ||
    !("order" in authorizedBy) ||
    authorizedBy.fillsBefore === undefined ||
    record.quote === undefined
  ) {
    return undefined;
  }
  const order = await parts.orders.get(authorizedBy.order, { signal });
  const card =
    order === undefined ? undefined : await parts.intents.confirmation(order.intentId, { signal });
  if (order === undefined || card === undefined) {
    return undefined;
  }
  const { fillsBefore } = authorizedBy;
  const binding = { order: order.id, orderTermsHash: card.termsHash, fillsBefore };
  // The fill as it reads now hashes to what its confirmation stored, or nothing signs it.
  const termsHash = fillTermsHash(snapshot.record, binding);
  return termsHash === authorizedBy.termsHash
    ? { order, orderTermsHash: card.termsHash, fillsBefore, termsHash }
    : undefined;
}

/**
 * The fill grant of a confirmed live fill (decision 0210): granted when the fill moved to
 * `confirmed`, for a trade card's lifetime, up to the chain's network fee cap, for at most what
 * its confirmed quote spends, bound to its order's confirmed terms and the fills its order had
 * before it. `undefined` for any other intent.
 */
export async function fillGrantOf(
  parts: FillTermsParts,
  snapshot: IntentSnapshot,
  call: { readonly networkFeeCapNativeBase: bigint; readonly signal: AbortSignal },
): Promise<{ readonly grant: FillGrant; readonly current: OrderNow } | undefined> {
  const { record, history } = snapshot;
  const confirmed = history.events.find((event) => event.toState === "confirmed");
  const binding = await bindingOf(parts, snapshot, call.signal);
  const spend = binding === undefined ? undefined : spendOf(parts, record);
  if (confirmed === undefined || binding === undefined || spend === undefined) {
    return undefined;
  }
  const grant: FillGrant = {
    order: binding.order.id,
    agent: record.agentId,
    intent: record.id,
    orderTermsHash: binding.orderTermsHash,
    fillsBefore: binding.fillsBefore,
    termsHash: binding.termsHash,
    grantedAtMs: confirmed.atMs,
    expiresAtMs: confirmed.atMs + fillGrantLifetimeMs,
    networkFeeCapNativeBase: call.networkFeeCapNativeBase,
    spend,
  };
  return { grant, current: orderNowOf(binding.order, binding.orderTermsHash) };
}

// A fill grant against its order now, as the signer checks it, for a step that spends what the
// grant allows: the signer holds each step's own spend to it.
function grantCheck(
  grant: FillGrant,
  current: OrderNow,
  at: { readonly nowMs: number; readonly stepIndex: number },
) {
  const { nowMs, stepIndex } = at;
  const { token, maxBase } = grant.spend;
  const action = { kind: "call", nativeValue: token === undefined ? maxBase : 0n } as const;
  const check = {
    intent: grant.intent,
    termsHash: grant.termsHash,
    order: current,
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
  current: OrderNow,
  at: { readonly nowMs: number; readonly stepIndex: number },
): SignAuthorization | undefined {
  return grantCheck(grant, current, at).ok ? { kind: "order", grant, current } : undefined;
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
    return checked.error === "expired" ? {} : { refusal: "order_inactive" };
  }
  const authorization = { kind: "order", grant: made.grant, current: made.current } as const;
  return { terms: { authorization, termsHash: made.grant.termsHash } };
}

/**
 * The order now of a fill grant, read again right before one more signature: its state, expiry
 * and fills as they stand, with its confirmed card's terms hash. `undefined` once the order or its
 * card is gone.
 */
export async function orderNowFor(
  parts: FillTermsParts,
  grant: FillGrant,
  signal: AbortSignal,
): Promise<OrderNow | undefined> {
  const order = await parts.orders.get(grant.order, { signal });
  const card =
    order === undefined ? undefined : await parts.intents.confirmation(order.intentId, { signal });
  return order === undefined || card === undefined ? undefined : orderNowOf(order, card.termsHash);
}
