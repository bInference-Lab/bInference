import type { Amount, ChainRegistry, PriceSource } from "@binference/chain";
import { type Clock, type Id, mulDiv } from "@binference/core";
import type { CopyOrderRequest } from "@binference/protocol";
import type { AgentSettings } from "../agents/agent-record.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { OrderSkipReason } from "../intents/intent-reason.js";
import { assetInfoOf } from "../money-path/asset-infos.js";
import { isUsablePrice } from "../positions/value-execution.js";
import {
  copyDayMs,
  isTakenLate,
  type CopyState,
  copyStateOf,
  type CopyTaking,
  type CopyTraded,
  usedInDayOf,
} from "./copy-state.js";
import type { FillPrice } from "./fill-orders.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";

/** A copy order: an order whose request is a copy order's. */
export type CopyOrder = OrderRecord & { readonly request: CopyOrderRequest };

/** What a copy order's buys used of a daily cap, and the cap, in micro-dollars. */
export interface CapUse {
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

/**
 * What a copy fill's plan reads: the agent's other copy orders, the registry, the USD prices that
 * value the leader's buy, and the time.
 */
export interface CopyFillParts {
  readonly orders: Pick<OrderStore, "copyBuys">;
  readonly chains: ChainRegistry;
  readonly prices: PriceSource;
  readonly clock: Clock;
}

/** The order as a copy order, or none for another kind. */
export function asCopyOrder(order: OrderRecord): CopyOrder | undefined {
  const { request } = order;
  return request.kind === "copy" ? { ...order, request } : undefined;
}

/** The dollars one buy spends: the order's, or the agent's `copy.perBuyUsd` when that is lower. */
function perBuyOf(order: CopyOrder, settings: AgentSettings): bigint {
  const own = order.request.trigger.perBuyUsdMicros;
  const agents = settings.limits.copyPerBuyUsdMicros;
  return agents < own ? agents : own;
}

// The page of stored copy buys one read takes; the sum reads on, page after page.
const buysPerPage = 500;

// The agent's copy buys of the order's leader in the last day, from its stored fills, in every
// copy order of that leader whatever its state, page after page (decision 0260).
async function agentUsedOf(
  parts: CopyFillParts,
  order: CopyOrder,
  call: {
    readonly nowMs: number;
    readonly signal: AbortSignal;
    readonly after?: { readonly atMs: number; readonly id: Id<"fil"> };
  },
): Promise<bigint> {
  const { nowMs, signal, after } = call;
  const query = {
    agentId: order.agentId,
    leader: order.request.trigger.leader,
    fromMs: nowMs - copyDayMs + 1,
    limit: buysPerPage,
    ...(after === undefined ? {} : { after }),
  };
  const page = await parts.orders.copyBuys(query, { signal });
  const sum = page.reduce((total, { usdMicros }) => total + usdMicros, 0n);
  const last = page.at(-1);
  if (page.length < buysPerPage || last === undefined) {
    return sum;
  }
  const next = { atMs: last.atMs, id: last.id };
  return sum + (await agentUsedOf(parts, order, { nowMs, signal, after: next }));
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

// The sale of the leader's share, which the sizing takes of what the order bought (decision 0260);
// a skip when the watcher did not read the share, or nothing knows the token's decimals.
function planSale(
  order: CopyOrder,
  call: { readonly taking: CopyTaking; readonly decimals: number | undefined },
): CopyFillPlan {
  const { taking, decimals } = call;
  const { shareSoldBps } = taking;
  if (shareSoldBps === undefined) {
    return { kind: "skip", reason: "share_unread" };
  }
  if (decimals === undefined) {
    return { kind: "skip", reason: "token_unreadable" };
  }
  const size = { percentBps: shareSoldBps };
  const request = { ...order.request, token: taking.asset, side: "sell" as const, size };
  return { kind: "fill", order: { ...order, request }, price: { decimals } };
}

// What the leader's buy is worth, as the policy values an outflow: what it paid at its USD price,
// rounded up; none when nothing prices it.
async function leaderValueOf(
  parts: CopyFillParts,
  taking: CopyTaking,
  signal: AbortSignal,
): Promise<bigint | undefined> {
  const { paid } = taking;
  if (paid === undefined) {
    return undefined;
  }
  const price = await parts.prices.usdPrice(paid.asset, { signal });
  return price.ok && isUsablePrice(price.value) ? mulDiv(paid.base, price.value, "up") : undefined;
}

// A buy's dollars: the least of the order's, the agent's and the leader's own buy (the owner's
// choice, decision 0260); none when the leader's buy has no value.
async function buyDollarsOf(
  parts: CopyFillParts,
  call: {
    readonly order: CopyOrder;
    readonly settings: AgentSettings;
    readonly taking: CopyTaking;
    readonly signal: AbortSignal;
  },
): Promise<bigint | undefined> {
  const capped = perBuyOf(call.order, call.settings);
  const leader = await leaderValueOf(parts, call.taking, call.signal);
  if (leader === undefined) {
    return undefined;
  }
  return leader < capped ? leader : capped;
}

/**
 * Plans the fill of the trade a copy order took (decision 0260), at the head of its agent's line:
 * none when it took none; a skip as `late` for a buy past its minute, as `share_unread` for a sale
 * whose share the watcher did not read, as `token_unreadable` for a token whose decimals nothing
 * knows, as `leader_unpriced` for a buy whose leader's spend nothing values, and as
 * `copy_daily_cap` for a buy that would pass the order's daily dollars or the agent's for the
 * leader; else the fill, as an order of the trade's token and side: a buy of the least of its
 * dollars per buy and the leader's own buy, or a sale of the leader's share.
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
  // A late buy is never made; a late sale is still made, at the price now (decision 0260).
  if (taking.side === "buy" && isTakenLate(taking, parts.clock.now())) {
    return { kind: "skip", reason: "late" };
  }
  const decimals = decimalsOf(parts.chains, taking);
  if (taking.side === "sell") {
    return planSale(order, { taking, decimals });
  }
  if (decimals === undefined) {
    return { kind: "skip", reason: "token_unreadable" };
  }
  return planBuy(parts, { order, state, settings, taking, decimals, signal });
}

/** The least a copy buy spends: smaller ones skip as `copy_too_small` (the owner's choice). */
const leastBuyUsdMicros = 5_000_000n;
/** The most copy buys one order makes in an hour: more skip as `copy_hourly` (the owner's choice). */
const mostBuysAnHour = 10;
const hourMs = 3_600_000;

// Why a buy skips before its caps: its leader's buy has no value, it would spend under $5, or the
// order bought 10 times in the last hour (decision 0260).
function floorOf(call: {
  readonly dollars: bigint | undefined;
  readonly state: CopyState;
  readonly nowMs: number;
}): "leader_unpriced" | "copy_too_small" | "copy_hourly" | undefined {
  const { dollars, state, nowMs } = call;
  if (dollars === undefined) {
    return "leader_unpriced";
  }
  if (dollars < leastBuyUsdMicros) {
    return "copy_too_small";
  }
  const lastHour = state.buys.filter(({ atMs }) => atMs > nowMs - hourMs).length;
  return lastHour >= mostBuysAnHour ? "copy_hourly" : undefined;
}

// A buy of the least of its dollars per buy and the leader's own buy, within the daily caps.
async function planBuy(
  parts: CopyFillParts,
  call: {
    readonly order: CopyOrder;
    readonly state: CopyState;
    readonly settings: AgentSettings;
    readonly taking: CopyTaking;
    readonly decimals: number;
    readonly signal: AbortSignal;
  },
): Promise<CopyFillPlan> {
  const { order, state, settings, taking, decimals, signal } = call;
  const dollars = await buyDollarsOf(parts, { order, settings, taking, signal });
  const nowMs = parts.clock.now();
  const floor = floorOf({ dollars, state, nowMs });
  if (floor !== undefined) {
    return { kind: "skip", reason: floor };
  }
  const usdMicros = dollars ?? 0n;
  const cap = await passedCapOf(parts, { order, state, settings, perBuy: usdMicros, signal });
  if (cap !== undefined) {
    return { kind: "skip", reason: "copy_daily_cap", cap };
  }
  const size = { usdMicros };
  const request = { ...order.request, token: taking.asset, side: "buy" as const, size };
  return { kind: "fill", order: { ...order, request }, price: { decimals } };
}

/**
 * What a copy order's fill traded, which its state counts (decision 0260): its side, its amounts,
 * and for a buy the value the policy judged it at, which the rolling cap counts too, else the
 * order's dollars per buy. `undefined` for any other order.
 */
export function copyTradedOf(
  order: OrderRecord,
  fill: {
    readonly snapshot: IntentSnapshot;
    readonly amountIn: Amount;
    readonly amountOut: Amount;
    readonly atMs: number;
  },
): CopyTraded | undefined {
  const copy = asCopyOrder(order);
  if (copy === undefined) {
    return undefined;
  }
  const { record } = fill.snapshot;
  const usdMicros = record.valueUsdMicros ?? copy.request.trigger.perBuyUsdMicros;
  const side = record.kind === "sell" ? "sell" : "buy";
  return { side, amountIn: fill.amountIn, amountOut: fill.amountOut, usdMicros, atMs: fill.atMs };
}
