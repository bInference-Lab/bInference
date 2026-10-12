import type { Clock, Id, IdSource, Ratio } from "@binference/core";
import type { ProtocolErrorCode } from "@binference/protocol";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { AgentStore, PositionStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { endEmptyExit, endLateExits, wasEmptiedSince } from "./end-exit-orders.js";
import { checkOf, resizedSaleOf } from "./fill-check.js";
import { announceOrder, type CancelFillParts, cancelFill, skipRowOf } from "./fill-ends.js";
import { unfinishedFills, withinDeadline } from "./fill-faults.js";
import { agentWideReasons, isWaiting, paceRows } from "./fill-pacing.js";
import { type FillSizeParts, type SizedFill, sizeFill } from "./fill-request.js";
import type { OrderFillReason } from "./order-fill.js";
import type { OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import type { PriceLevel } from "./price-level.js";

/** The price a trigger fired an order's fill at, as the price watcher read it. */
export interface FillPrice {
  /** Micro-dollars for one base unit of the order's token, exact. */
  readonly usdPerBaseUnit: Ratio;
  readonly decimals: number;
  /** The level the fill's own quote must meet: a thin pool priced the token (decision 0195). */
  readonly confirm?: PriceLevel;
}

/** What a fill came to: filled, skipped, its exit order ended, waiting after a skip, or no fill. */
type FillOutcome = "filled" | "skipped" | "ended" | "waiting" | "inactive";

/**
 * Auto order fills (decision 0195): a trigger hands an order and the price it fired at, and the
 * fill runs the money path with no card, held to the order's bounds, or is skipped and reported.
 */
export interface OrderFills {
  /**
   * Fills an active order at a trigger's price, one fill of an agent at a time. An order that is
   * not active, already has a fill under way, or still waits after a skip, fills nothing.
   */
  run(
    request: { readonly order: Id<"ord">; readonly price: FillPrice },
    options: { readonly signal: AbortSignal },
  ): Promise<FillOutcome>;
}

/** What the fills read, run and write through, and where their notices go. */
export interface OrderFillsParts extends FillSizeParts {
  readonly orders: OrderStore;
  readonly agents: AgentStore;
  readonly stored: StoredIntents;
  readonly moneyPath: MoneyPath;
  /** The rolling cap, whose use a skip for it reports. */
  readonly gate: CapGate;
  /** Whether the engine is locked: a locked engine fills nothing (decision 0195). */
  readonly isLocked: () => boolean;
  /** Whether a live order may fill; off until the crash suite on fills passes. */
  readonly liveFills: boolean;
  /** The positions, which tell whether a sale emptied an exit order's position. */
  readonly positions: Pick<PositionStore, "positions">;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly publish: PublishPush;
}

interface FillState {
  readonly running: Set<Id<"ord">>;
  readonly lines: Map<Id<"agt">, Promise<void>>;
  /** The agent-wide reasons each agent heard since its last fill or the engine's start. */
  readonly told: Map<Id<"agt">, Set<OrderFillReason>>;
}

/** One skip before any intent: its order, its reason, and the signal of its run. */
interface Skip {
  readonly order: OrderRecord;
  readonly reason: OrderFillReason;
  readonly signal: AbortSignal;
}

// The parts a skip's row and a fill's cancel are written with.
function rowParts(parts: OrderFillsParts): CancelFillParts {
  const { orders, ids, stored, clock, gate } = parts;
  const spent: CapGate["spent"] = async (snapshot, call) => gate.spent(snapshot, call);
  return { orders, ids, stored, clock, spent };
}

// An agent-wide reason is heard once per agent until one of its orders fills (decision 0197);
// `undefined` for a reason of the order's own, heard once in a row.
function agentWideTells(state: FillState, skipped: Skip): boolean | undefined {
  const { order, reason } = skipped;
  if (!agentWideReasons.has(reason)) {
    return undefined;
  }
  const heard = state.told.get(order.agentId) ?? new Set<OrderFillReason>();
  const isNew = !heard.has(reason);
  state.told.set(order.agentId, heard.add(reason));
  return isNew;
}

// Stores a skip before any intent, with its notice in the same write, and tells the owner; the
// order stays as it is.
async function skip(parts: OrderFillsParts, state: FillState, skipped: Skip): Promise<FillOutcome> {
  const { order, reason, signal } = skipped;
  const tells = agentWideTells(state, skipped);
  const atMs = parts.clock.now();
  const call = { order, reason, atMs, signal, ...(tells === undefined ? {} : { tells }) };
  const row = await skipRowOf(rowParts(parts), call);
  await parts.orders.recordFill(row, { signal });
  await announceOrder(parts, order.id, signal);
  return "skipped";
}

// The skip of a proposal the money path refused before storing an intent: a route or venue it
// could not find, by its own name; anything else, such as an agent archived meanwhile, a fault of
// the fill, told once and paced.
function proposalSkipOf(code: ProtocolErrorCode): OrderFillReason {
  if (code === "quote.no_route") {
    return "no_route";
  }
  return code === "quote.venue_down" ? "venue_down" : "fill_failed";
}

// What the fill's intent came to. Its row and notices were written with its end; they are told
// now. A fill still `confirmed`, which no paper fill took, is cancelled unsigned.
async function settle(
  parts: OrderFillsParts,
  state: FillState,
  run: {
    readonly order: OrderRecord;
    readonly snapshot: IntentSnapshot;
    readonly signal: AbortSignal;
  },
): Promise<FillOutcome> {
  const { order, signal } = run;
  const snapshot =
    run.snapshot.record.state === "confirmed"
      ? await cancelFill(rowParts(parts), { snapshot: run.snapshot, signal })
      : run.snapshot;
  const rows = await announceOrder(parts, order.id, signal);
  if (snapshot.record.state === "paper_filled") {
    state.told.delete(order.agentId);
    await endLateExits(parts, { filled: order, signal });
    return "filled";
  }
  // A skip wrote its row with its intent's end; a stop's cancel, or one the fill made, wrote none.
  const intent = snapshot.record.id;
  return rows.some(({ intentId }) => intentId === intent) ? "skipped" : "inactive";
}

// A gate a fill meets before any intent: a live order while live fills are off, a locked engine.
function gateOf(parts: OrderFillsParts, order: OrderRecord): OrderFillReason | undefined {
  if (!order.isPaper && !parts.liveFills) {
    return "live_fills_off";
  }
  return parts.isLocked() ? "engine_locked" : undefined;
}

// Proposes a sized fill on the money path, authorized by its order, in its order's mode.
async function proposeFill(
  parts: OrderFillsParts,
  fill: {
    readonly order: OrderRecord;
    readonly sized: SizedFill;
    readonly price: FillPrice;
    readonly signal: AbortSignal;
  },
): ReturnType<MoneyPath["propose"]> {
  const { order, sized, price, signal } = fill;
  const proposer = {
    role: "engine",
    ref: "engine",
    hasOutsideContent: order.hasOutsideContent,
  } as const;
  const proposal = {
    authorization: { order: order.id },
    isPaper: order.isPaper,
    decimals: price.decimals,
    check: checkOf(parts, { order, sized, price }),
  };
  return parts.moneyPath.propose(sized.request, proposer, { signal, fill: proposal });
}

async function fillNow(
  parts: OrderFillsParts,
  state: FillState,
  request: {
    readonly order: OrderRecord;
    readonly price: FillPrice;
    readonly signal: AbortSignal;
  },
): Promise<FillOutcome> {
  const { order, price, signal } = request;
  const gated = gateOf(parts, order);
  if (gated !== undefined) {
    return skip(parts, state, { order, reason: gated, signal });
  }
  const settings = await parts.agents.get(order.agentId, { signal });
  if (settings === undefined) {
    return "inactive";
  }
  const sizing = { order, settings, tokenUsd: price.usdPerBaseUnit, signal };
  const sized = await sizeFill(parts, sizing);
  if (sized.kind === "empty") {
    return emptyExit(parts, state, { order, signal });
  }
  if (sized.kind === "skip") {
    return skip(parts, state, { order, reason: sized.reason, signal });
  }
  const first = await proposeFill(parts, { order, sized, price, signal });
  // A sale in dollars that its quote valued above its size is sized again at that quote's price.
  const resized = first.ok
    ? await resizedSaleOf(parts, { order, sized, snapshot: first.value, signal })
    : undefined;
  const proposed =
    resized === undefined
      ? first
      : await proposeFill(parts, { order, sized: resized, price, signal });
  if (!proposed.ok) {
    return skip(parts, state, { order, reason: proposalSkipOf(proposed.error), signal });
  }
  return settle(parts, state, { order, snapshot: proposed.value, signal });
}

// A fill that threw is a skip, `fill_failed`, paced as any skip: the newest intent it left
// unfinished is cancelled unsigned with the skip's row, and any older one with none (decision
// 0197).
async function failed(
  parts: OrderFillsParts,
  state: FillState,
  run: { readonly order: OrderRecord; readonly signal: AbortSignal },
): Promise<FillOutcome> {
  const { order, signal } = run;
  const query = { isPaper: order.isPaper, agentId: order.agentId, order: order.id };
  const left = await unfinishedFills(parts.stored, query, { signal });
  const newest = left.at(-1);
  // One at a time, so no two writes of one order race.
  await left.slice(0, -1).reduce(async (before, snapshot) => {
    await before;
    await cancelFill(rowParts(parts), { snapshot, signal });
  }, Promise.resolve());
  if (newest === undefined) {
    return skip(parts, state, { order, reason: "fill_failed", signal });
  }
  const skipped = { order, reason: "fill_failed" as const };
  await cancelFill(rowParts(parts), { snapshot: newest, skip: skipped, signal });
  await announceOrder(parts, order.id, signal);
  return "skipped";
}

// Runs the fill within its deadline; a fault in it, or a fill past its deadline, is a skip. A stop
// is no fault: it throws on.
async function fillOrFail(
  parts: OrderFillsParts,
  state: FillState,
  run: { readonly order: OrderRecord; readonly price: FillPrice; readonly signal: AbortSignal },
): Promise<FillOutcome> {
  try {
    const { clock } = parts;
    return await withinDeadline({ clock, signal: run.signal }, async (signal) =>
      fillNow(parts, state, { ...run, signal }),
    );
  } catch (error) {
    if (run.signal.aborted) {
      throw error;
    }
    return failed(parts, state, run);
  }
}

// An exit order whose position holds none of the token ends when a sale emptied it after the order
// was made; one whose position was never held, as before its buy settles, waits as a skip,
// `nothing_to_sell` (decision 0197).
async function emptyExit(
  parts: OrderFillsParts,
  state: FillState,
  run: { readonly order: OrderRecord; readonly signal: AbortSignal },
): Promise<FillOutcome> {
  const { order, signal } = run;
  if (!(await wasEmptiedSince(parts.positions, run))) {
    return skip(parts, state, { order, reason: "nothing_to_sell", signal });
  }
  await endEmptyExit(parts, { order, nowMs: parts.clock.now(), signal });
  return "ended";
}

// Runs `work` once every earlier fill of the agent has ended.
async function inLine<T>(state: FillState, agent: Id<"agt">, work: () => Promise<T>): Promise<T> {
  const before = state.lines.get(agent) ?? Promise.resolve();
  const run = before.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  state.lines.set(agent, tail);
  try {
    return await run;
  } finally {
    if (state.lines.get(agent) === tail) {
      state.lines.delete(agent);
    }
  }
}

/**
 * Creates the {@link OrderFills}. One agent's fills run one at a time, oldest trigger first, so one
 * position's exit fills never run at once; an order has one fill under way at most. A live order
 * skips with `live_fills_off` while live fills are off, and a locked engine skips every fill with
 * `engine_locked`, the order staying active either way (decision 0195).
 */
export function createOrderFills(parts: OrderFillsParts): OrderFills {
  const state: FillState = { running: new Set(), lines: new Map(), told: new Map() };
  return {
    async run({ order: id, price }, { signal }) {
      const read = await parts.orders.get(id, { signal });
      if (read?.state !== "active" || state.running.has(id)) {
        return "inactive";
      }
      const rows = await parts.orders.fills({ orderId: id, limit: paceRows }, { signal });
      if (isWaiting(read, rows, parts.clock.now())) {
        return "waiting";
      }
      state.running.add(id);
      try {
        return await inLine(state, read.agentId, async () => {
          const order = await parts.orders.get(id, { signal });
          return order?.state === "active" && parts.clock.now() < order.expiresAtMs
            ? fillOrFail(parts, state, { order, price, signal })
            : "inactive";
        });
      } finally {
        state.running.delete(id);
      }
    },
  };
}
