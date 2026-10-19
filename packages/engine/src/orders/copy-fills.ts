import type { ChainRegistry } from "@binference/chain";
import type { Clock } from "@binference/core";
import type { CopyOrderRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { OrderSkipReason } from "../intents/intent-reason.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { type CopyState, copyStateOf, type CopyTaking, usedInDayOf } from "./copy-state.js";
import type { FillPrice } from "./fill-orders.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/**
 * How late a leader's trade may still be copied (decision 0260): its block time at most this long
 * before its copy reaches the head of its agent's line of fills.
 */
export const copyGraceMs = 60_000;

/** A copy order: an order whose request is a copy order's. */
export type CopyOrder = OrderRecord & { readonly request: CopyOrderRequest };

/** What a copy order's buys used of a daily cap, and the cap, in micro-dollars. */
interface CapUse {
  readonly usedUsdMicros: bigint;
  readonly capUsdMicros: bigint;
}

/**
 * What a copy order's fill comes to at the head of its agent's line: nothing taken, a skip before
 * any intent, or the fill of the trade it took, as an order of that trade's token and side.
 */
export type CopyFillPlan =
  | { readonly kind: "none" }
  | { readonly kind: "skip"; readonly reason: OrderSkipReason; readonly cap?: CapUse }
  | { readonly kind: "fill"; readonly order: CopyOrder; readonly price: FillPrice };

/** What a copy fill's plan reads: the agent's other copy orders, the registry and the time. */
export interface CopyFillParts {
  readonly orders: Pick<OrderStore, "list">;
  readonly chains: ChainRegistry;
  readonly clock: Clock;
}

/** The order as a copy order, or none for another kind. */
function asCopyOrder(order: OrderRecord): CopyOrder | undefined {
  const { request } = order;
  return request.kind === "copy" ? { ...order, request } : undefined;
}

/** The dollars one buy spends: the order's, or the agent's `copy.perBuyUsd` when that is lower. */
function perBuyOf(order: CopyOrder, settings: AgentSettings): bigint {
  const own = order.request.trigger.perBuyUsdMicros;
  const agents = settings.limits.copyPerBuyUsdMicros;
  return agents < own ? agents : own;
}

// The agent's copy buys of the order's leader in the last day, over its active and paused copy
// orders.
async function agentUsedOf(
  parts: CopyFillParts,
  order: CopyOrder,
  call: { readonly nowMs: number; readonly signal: AbortSignal },
): Promise<bigint> {
  const query = { states: ["active", "paused"] as const, agentId: order.agentId, limit: 1_000 };
  const running = await parts.orders.list(query, { signal: call.signal });
  return running.reduce((sum, other) => {
    const copy = asCopyOrder(other);
    const state = copyStateOf(other.triggerState);
    const isSameLeader = copy?.request.trigger.leader === order.request.trigger.leader;
    return isSameLeader && state !== undefined ? sum + usedInDayOf(state, call.nowMs) : sum;
  }, 0n);
}

// The cap a buy of `perBuy` would pass: the order's daily dollars, then the agent's per leader.
async function passedCapOf(
  parts: CopyFillParts,
  call: {
    readonly order: CopyOrder;
    readonly state: CopyState;
    readonly settings: AgentSettings;
    readonly perBuy: bigint;
    readonly signal: AbortSignal;
  },
): Promise<CapUse | undefined> {
  const { order, state, settings, perBuy, signal } = call;
  const nowMs = parts.clock.now();
  const own = usedInDayOf(state, nowMs);
  const ownCap = order.request.trigger.dailyUsdMicros;
  if (own + perBuy > ownCap) {
    return { usedUsdMicros: own, capUsdMicros: ownCap };
  }
  const agents = await agentUsedOf(parts, order, { nowMs, signal });
  const agentsCap = settings.limits.copyPerLeaderDayUsdMicros;
  return agents + perBuy > agentsCap
    ? { usedUsdMicros: agents, capUsdMicros: agentsCap }
    : undefined;
}

// The decimals of the trade's token: the registry's, else what it answered as the order took it.
function decimalsOf(chains: ChainRegistry, taking: CopyTaking): number | undefined {
  return assetInfoOf(chains, taking.asset)?.decimals ?? taking.facts?.decimals;
}

// The order as the fill of its trade: a buy of the trade's token at its dollars per buy, or a sale
// of the leader's share, which the sizing takes of what the order bought (decision 0260); none for
// a sale whose share the watcher did not read.
function fillOrderOf(order: CopyOrder, taking: CopyTaking, perBuy: bigint): CopyOrder | undefined {
  const { side, asset, shareSoldBps } = taking;
  if (side === "buy") {
    return {
      ...order,
      request: { ...order.request, token: asset, side, size: { usdMicros: perBuy } },
    };
  }
  return shareSoldBps === undefined
    ? undefined
    : {
        ...order,
        request: { ...order.request, token: asset, side, size: { percentBps: shareSoldBps } },
      };
}

/**
 * Plans the fill of the trade a copy order took (decision 0260), at the head of its agent's line:
 * none when it took none; a skip as `late` past its minute, as `share_unread` for a sale whose
 * share the watcher did not read, as `token_unreadable` for a token whose decimals nothing knows, and as `copy_daily_cap` for a buy that would pass the order's daily dollars or the agent's
 * for the leader; else the fill, as an order of the trade's token and side.
 */
export async function planCopyFill(
  parts: CopyFillParts,
  call: {
    readonly order: CopyOrder;
    readonly settings: AgentSettings;
    readonly signal: AbortSignal;
  },
): Promise<CopyFillPlan> {
  const { order, settings, signal } = call;
  const state = copyStateOf(order.triggerState);
  const taking = state?.taking;
  if (state === undefined || taking === undefined) {
    return { kind: "none" };
  }
  if (parts.clock.now() - taking.atMs > copyGraceMs) {
    return { kind: "skip", reason: "late" };
  }
  const perBuy = perBuyOf(order, settings);
  const filling = fillOrderOf(order, taking, perBuy);
  const decimals = decimalsOf(parts.chains, taking);
  if (filling === undefined) {
    return { kind: "skip", reason: "share_unread" };
  }
  if (decimals === undefined) {
    return { kind: "skip", reason: "token_unreadable" };
  }
  if (taking.side === "sell") {
    return { kind: "fill", order: filling, price: { decimals } };
  }
  const cap = await passedCapOf(parts, { order, state, settings, perBuy, signal });
  return cap === undefined
    ? { kind: "fill", order: filling, price: { decimals } }
    : { kind: "skip", reason: "copy_daily_cap", cap };
}
