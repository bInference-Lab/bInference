import type { AssetRef } from "@binference/chain";
import type { Bps, Id } from "@binference/core";
import type { FillSize } from "@binference/protocol";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { copiedHeldOf, copyStateOf } from "./copy-state.js";
import type { BoundedOrder } from "./fill-bounds.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/**
 * The terms one fill is sized and held to: an auto order's, or a webhook rule's (decision 0338).
 * Both trade one token, on one side, from one wallet, in the mode they were made in.
 */
export interface FillTerms {
  /** The order or rule the fill runs under, which a fault names. */
  readonly source: Id<"ord"> | Id<"whr">;
  readonly agentId: Id<"agt">;
  readonly walletId: Id<"wal">;
  readonly isPaper: boolean;
  readonly token: AssetRef;
  readonly side: "buy" | "sell";
  readonly size: FillSize;
  /** What a buy spends; absent, the chain's coin. */
  readonly spend?: AssetRef;
  readonly maxSlippageBps?: Bps;
  /** The words the fill's request carries as its reason. */
  readonly reason: string;
  /**
   * A copy order's sale: what the order bought of the token less what it sold, the most it may
   * sell (decision 0260).
   */
  readonly copiedBase?: bigint;
  /**
   * Whether a sale by share sells the amount its share came to at sizing, as a copy order's does,
   * rather than its share of what the wallet holds when its quote is built.
   */
  readonly isShareSizedNow: boolean;
}

/** One fill's terms, how its source stands now, and what else breaks its size. */
export interface FillSubject {
  readonly terms: FillTerms;
  /**
   * The order or rule as it stands now, while it has the fills the fill was sized for: a fill it
   * recorded since leaves the fill nothing to fill, and answers `undefined`.
   */
  readonly current: (signal: AbortSignal) => Promise<BoundedOrder | undefined>;
  /** Whether the policy's value of the fill breaks its size, as a copy buy's may (decision 0260). */
  readonly isOverSize: (simulated: IntentSnapshot) => boolean;
}

// What a copy order's sale may take its share of; none for any other fill.
function copiedOf(order: OrderRecord): bigint | undefined {
  const { request } = order;
  const state = request.kind === "copy" ? copyStateOf(order.triggerState) : undefined;
  return state === undefined || request.side !== "sell"
    ? undefined
    : copiedHeldOf(state, request.token);
}

/** The terms of an auto order's fill. */
export function orderFillTerms(order: OrderRecord): FillTerms {
  const { request } = order;
  const copied = copiedOf(order);
  return {
    source: order.id,
    agentId: order.agentId,
    walletId: order.walletId,
    isPaper: order.isPaper,
    token: request.token,
    side: request.side,
    size: request.size,
    ...(request.spend === undefined ? {} : { spend: request.spend }),
    ...(request.maxSlippageBps === undefined ? {} : { maxSlippageBps: request.maxSlippageBps }),
    reason: request.reason ?? order.id,
    ...(copied === undefined ? {} : { copiedBase: copied }),
    isShareSizedNow: request.kind === "copy",
  };
}

// A copy buy the policy valued above its dollars per buy, or did not value, breaks its size
// (decision 0260).
function isOverCopyBuy(order: OrderRecord, simulated: IntentSnapshot): boolean {
  const { request } = order;
  if (request.kind !== "copy" || request.side !== "buy" || !("usdMicros" in request.size)) {
    return false;
  }
  const value = simulated.record.valueUsdMicros;
  return value === undefined || value > request.size.usdMicros;
}

/** An auto order's fill, held to the order as it stands while it keeps the fills it had. */
export function orderFillSubject(orders: Pick<OrderStore, "get">, order: OrderRecord): FillSubject {
  return {
    terms: orderFillTerms(order),
    current: async (signal) => {
      const now = await orders.get(order.id, { signal });
      return now?.fills === order.fills ? now : undefined;
    },
    isOverSize: (simulated) => isOverCopyBuy(order, simulated),
  };
}
