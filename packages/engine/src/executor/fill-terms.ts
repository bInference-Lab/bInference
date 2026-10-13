import {
  accountRefSchema,
  type ChainRegistry,
  assetRefParts,
  checkFillGrant,
  type FillGrant,
  type OrderNow,
  type SignAuthorization,
} from "@binference/chain";
import { type Clock, stableJson } from "@binference/core";
import { cardExpiresAt } from "../intents/card-rules.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { nativeAssetOf } from "../money-path/resolve-proposal.js";
import type { OrderRecord } from "../orders/order-record.js";
import type { OrderStore } from "../orders/ports.js";
import type { IntentStore } from "../ports.js";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";

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
}

/**
 * The terms hash of an auto order's live fill (decision 0210): the SHA-256 of the intent's id, its
 * order with the terms hash of the order's confirmed card and the fills the order had before the
 * fill, the request, the quote and the plan, as a card's terms hash covers what the card shows and
 * what runs. The engine sends it with each signing request of the fill.
 */
function fillTermsHash(record: IntentRecord, binding: FillBinding): Sha256Hex {
  const terms = {
    intent: record.id,
    order: binding.order.id,
    orderTermsHash: binding.orderTermsHash,
    fillsBefore: binding.fillsBefore,
    request: record.request,
    quote: record.quote ?? null,
    plan: record.plan ?? null,
  };
  return sha256Hex(stableJson(terms));
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
  return order === undefined || card === undefined
    ? undefined
    : { order, orderTermsHash: card.termsHash, fillsBefore: authorizedBy.fillsBefore };
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
  const { record, history, stored } = snapshot;
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
    termsHash: fillTermsHash(record, binding),
    grantedAtMs: confirmed.atMs,
    expiresAtMs: cardExpiresAt(record.kind, confirmed.atMs, stored.cards),
    networkFeeCapNativeBase: call.networkFeeCapNativeBase,
    spend,
  };
  return { grant, current: orderNowOf(binding.order, binding.orderTermsHash) };
}

/**
 * Whether a fill grant still holds against its order now, as the signer checks it, for a step
 * that spends what the grant allows: the signer holds each step's own spend to it.
 */
export function fillGrantHolds(
  grant: FillGrant,
  current: OrderNow,
  nowMs: number,
): SignAuthorization | undefined {
  const { token, maxBase } = grant.spend;
  const action = { kind: "call", nativeValue: token === undefined ? maxBase : 0n } as const;
  const check = {
    intent: grant.intent,
    termsHash: grant.termsHash,
    order: current,
    action,
    isCancel: false,
    nowMs,
  };
  return checkFillGrant(grant, check).ok ? { kind: "order", grant, current } : undefined;
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
