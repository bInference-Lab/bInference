import type { Clock, Id, IdSource, Ratio } from "@binference/core";
import type { AgentSettings } from "../agents/agent-record.js";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { isTerminalState } from "../intents/intent-state.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { AgentStore, IntentStore, PositionStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { asCopyOrder, planCopyFill } from "./copy-fills.js";
import { isPeriodLate } from "./dca-period.js";
import { endEmptyExit, endLateExits, wasEmptiedSince } from "./end-exit-orders.js";
import { checkOf, resizedSaleOf } from "./fill-check.js";
import { announceOrder, cancelFill, proposalSkipOf } from "./fill-ends.js";
import { canFire, isLineHeld, unfinishedFills, withinDeadline } from "./fill-faults.js";
import { chainFailuresInRow, isWaiting, paceRows, stopAfterFailures } from "./fill-pacing.js";
import { type FillSizeParts, type SizedFill, sizeFill } from "./fill-request.js";
import { type FillState, rowParts, type Skip, skipFill } from "./fill-skips.js";
import { proposedTermsHash } from "./fill-terms-hash.js";
import type { OrderFillReason } from "./order-fill.js";
import { isExitOrder, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import type { PriceLevel } from "./price-level.js";
import type { ResumeFence } from "./resume-fence.js";
import { runInLine } from "./run-in-line.js";
import { stopFailing } from "./stop-failing.js";

/**
 * The price a trigger fired an order's fill at, as the price watcher read it, or the token's
 * decimals alone for a DCA order's buy, which its period fires (decision 0246).
 */
export interface FillPrice {
  /** Micro-dollars for one base unit of the order's token, exact; absent for a DCA buy. */
  readonly usdPerBaseUnit?: Ratio;
  readonly decimals: number;
  /** The level the fill's own quote must meet: a thin pool priced the token (decision 0195). */
  readonly confirm?: PriceLevel;
  /**
   * How many resumes the engine had seen when the trigger fired, absent for a DCA buy: a resume
   * found since ends the fill `price_stale` (decision 0268).
   */
  readonly resumes?: number;
}

/**
 * What a fill came to: filled, skipped, its exit order ended, waiting after a skip or behind its
 * agent's live fill, a live fill handed to the executor, which records it as it settles, or no
 * fill.
 */
export type FillOutcome = "filled" | "skipped" | "ended" | "waiting" | "sent" | "inactive";

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
    request: {
      readonly order: Id<"ord">;
      readonly price: FillPrice;
      /**
       * A DCA order's period, judged again at the head of the agent's line: past its minute, the
       * fill skips as `late` (decision 0246).
       */
      readonly period?: { readonly dueAtMs: number };
    },
    options: { readonly signal: AbortSignal },
  ): Promise<FillOutcome>;
  /**
   * Records a skip of an order's fill before any intent, with its notice, as a skip of `run`
   * does: a DCA order's period missed while it could not fill (decision 0246).
   */
  skip(
    request: { readonly order: Id<"ord">; readonly reason: OrderFillReason },
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

/** What the fills read, run and write through, and where their notices go. */
export interface OrderFillsParts extends FillSizeParts {
  readonly orders: OrderStore;
  /**
   * The intents, whose live fills in flight hold an agent's line and whose order cards' terms a
   * fill's terms hash binds (decision 0211).
   */
  readonly intents: Pick<IntentStore, "fillsInFlight" | "confirmation">;
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
  /**
   * The downtime re-check, which ends a fill whose price was read before a resume, and reports a
   * resume's skips in its one report (decisions 0267 and 0268); none in a test without one.
   */
  readonly fence?: Pick<ResumeFence, "resumes" | "holds">;
}

// What the fill's intent came to. Its row and notices were written with its end; they are told
// now. A paper fill still `confirmed`, which no paper fill took, is cancelled unsigned. A live
// fill the executor took is never cancelled here: it may be signing already, and the executor
// records it on its order as it settles (decision 0210).
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
  const { record } = run.snapshot;
  if (!record.isPaper && !isTerminalState(record.state)) {
    return "sent";
  }
  const snapshot =
    record.state === "confirmed"
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
    authorization: { order: order.id, fillsBefore: order.fills },
    isPaper: order.isPaper,
    decimals: price.decimals,
    check: checkOf(parts, { order, sized, price }),
    termsHash: async (simulated: IntentSnapshot, call: { readonly signal: AbortSignal }) =>
      proposedTermsHash(parts.intents, { order, simulated, signal: call.signal }),
  };
  return parts.moneyPath.propose(sized.request, proposer, { signal, fill: proposal });
}

// The order and price a fill runs with: the order's own, or a copy order's taken trade as an
// order of that trade's token and side (decision 0260); else a skip, or nothing to fill.
async function fillingOf(
  parts: OrderFillsParts,
  request: {
    readonly order: OrderRecord;
    readonly price: FillPrice;
    readonly settings: AgentSettings;
    readonly signal: AbortSignal;
  },
): Promise<
  | { readonly kind: "fill"; readonly order: OrderRecord; readonly price: FillPrice }
  | { readonly kind: "skip"; readonly skip: Omit<Skip, "signal"> }
  | { readonly kind: "none" }
> {
  const { order, price, settings, signal } = request;
  const copy = asCopyOrder(order);
  if (copy === undefined) {
    return { kind: "fill", order, price };
  }
  const plan = await planCopyFill(parts, { order: copy, settings, signal });
  if (plan.kind !== "skip") {
    return plan;
  }
  const { reason, cap } = plan;
  return { kind: "skip", skip: { order, reason, ...(cap === undefined ? {} : { cap }) } };
}

// Sizes the fill and proposes it, and a sale in dollars again at its own quote's price when that
// quote valued it above its size.
async function sizeAndPropose(
  parts: OrderFillsParts,
  state: FillState,
  run: {
    readonly order: OrderRecord;
    readonly price: FillPrice;
    readonly settings: AgentSettings;
    readonly signal: AbortSignal;
  },
): Promise<FillOutcome> {
  const { order, price, settings, signal } = run;
  const tokenUsd = price.usdPerBaseUnit === undefined ? {} : { tokenUsd: price.usdPerBaseUnit };
  const sized = await sizeFill(parts, { order, settings, ...tokenUsd, signal });
  if (sized.kind === "empty") {
    // Only an exit order ends with its position; a copy sale of nothing is a skip.
    return isExitOrder(order.request)
      ? emptyExit(parts, state, { order, signal })
      : skipFill(parts, state, { order, reason: "nothing_to_sell", signal });
  }
  if (sized.kind === "skip") {
    return skipFill(parts, state, { order, reason: sized.reason, signal });
  }
  const first = await proposeFill(parts, { order, sized, price, signal });
  const resized = first.ok
    ? await resizedSaleOf(parts, { order, sized, snapshot: first.value, signal })
    : undefined;
  const proposed =
    resized === undefined
      ? first
      : await proposeFill(parts, { order, sized: resized, price, signal });
  if (!proposed.ok) {
    return skipFill(parts, state, { order, reason: proposalSkipOf(proposed.error), signal });
  }
  return settle(parts, state, { order, snapshot: proposed.value, signal });
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
  const { order, signal } = request;
  const gated = gateOf(parts, order);
  if (gated !== undefined) {
    return skipFill(parts, state, { order, reason: gated, signal });
  }
  const settings = await parts.agents.get(order.agentId, { signal });
  if (settings === undefined) {
    return "inactive";
  }
  const filling = await fillingOf(parts, { ...request, settings });
  if (filling.kind === "skip") {
    return skipFill(parts, state, { ...filling.skip, signal });
  }
  return filling.kind === "none"
    ? "inactive"
    : sizeAndPropose(parts, state, { ...filling, settings, signal });
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
    return skipFill(parts, state, { order, reason: "fill_failed", signal });
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
    return skipFill(parts, state, { order, reason: "nothing_to_sell", signal });
  }
  await endEmptyExit(parts, { order, nowMs: parts.clock.now(), signal });
  return "ended";
}

/**
 * Creates the {@link OrderFills}. One agent's fills run one at a time, oldest trigger first, so one
 * position's exit fills never run at once; an order has one fill under way at most, and a live
 * fill holds the agent's line until it settles (decision 0210). A live order
 * skips with `live_fills_off` while live fills are off, and a locked engine skips every fill with
 * `engine_locked`, the order staying active either way (decision 0195).
 */
export function createOrderFills(parts: OrderFillsParts): OrderFills {
  const state: FillState = { running: new Set(), lines: new Map(), told: new Map() };
  return {
    async skip({ order: id, reason }, { signal }) {
      const order = await parts.orders.get(id, { signal });
      if (order !== undefined) {
        await skipFill(parts, state, { order, reason, signal });
      }
    },
    async run({ order: id, price, period }, { signal }) {
      const read = await parts.orders.get(id, { signal });
      if (read?.state !== "active" || state.running.has(id)) {
        return "inactive";
      }
      const rows = await parts.orders.fills({ orderId: id, limit: paceRows }, { signal });
      if (chainFailuresInRow(rows) >= stopAfterFailures) {
        return stopFailing(parts, { order: read, signal });
      }
      if (isWaiting(read, rows, parts.clock.now())) {
        return "waiting";
      }
      state.running.add(id);
      try {
        // One agent's fills run one at a time, oldest trigger first.
        return await runInLine(state.lines, read.agentId, async () => {
          const order = await parts.orders.get(id, { signal });
          if (!canFire(parts, order)) {
            return "inactive";
          }
          // A live order's line holds until the agent's live fill is counted, across a restart too.
          if (await isLineHeld(parts, order, signal)) {
            return "waiting";
          }
          return period !== undefined && isPeriodLate(period.dueAtMs, parts.clock.now())
            ? skipFill(parts, state, { order, reason: "late", signal })
            : fillOrFail(parts, state, { order, price, signal });
        });
      } finally {
        state.running.delete(id);
      }
    },
  };
}
