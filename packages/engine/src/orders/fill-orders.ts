import type { Clock, Id, IdSource, Ratio } from "@binference/core";
import type { CapGate } from "../confirmations/cap-gate.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { quoteDocument } from "../intents/intent-documents.schema.js";
import { paperFillOf } from "../intents/intent-history.js";
import type { FillProposal } from "../money-path/authorize-simulated.js";
import type { MoneyPath } from "../money-path/create-money-path.js";
import type { AgentStore } from "../ports.js";
import { isUsablePrice } from "../positions/value-execution.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import { cancelCard } from "./cancel-order.js";
import { endEmptyExit } from "./end-exit-orders.js";
import { checkFill } from "./fill-bounds.js";
import { fillNotice, skippedNotice } from "./fill-notices.js";
import { agentWideReasons, isNewReason, isWaiting, paceRows } from "./fill-pacing.js";
import { type FillSizeParts, type SizedFill, sizeFill } from "./fill-request.js";
import type { OrderFillReason, OrderFillRecord } from "./order-fill.js";
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

interface Skip {
  readonly order: OrderRecord;
  /** The order's newest fill rows before this skip. */
  readonly rows: readonly OrderFillRecord[];
  readonly reason: OrderFillReason;
  readonly intent?: IntentSnapshot;
  readonly signal: AbortSignal;
}

// What the owner reads of a skip for the rolling cap: what the agent used of it, and the cap.
async function capOf(parts: OrderFillsParts, skipped: Skip) {
  const { intent, reason, signal } = skipped;
  if (intent === undefined || reason !== "daily_cap") {
    return undefined;
  }
  const usedUsdMicros = await parts.gate.spent(intent, { signal });
  return { usedUsdMicros, capUsdMicros: intent.settings.limits.rollingDayUsdMicros };
}

// The owner hears a skip once per reason in a row for its order, and an agent-wide reason once per
// agent until one of its orders fills (decision 0197).
function shouldTell(state: FillState, skipped: Skip): boolean {
  const { order, reason, rows } = skipped;
  const heard = state.told.get(order.agentId) ?? new Set<OrderFillReason>();
  if (!agentWideReasons.has(reason)) {
    return isNewReason(rows, reason);
  }
  const isNew = !heard.has(reason);
  state.told.set(order.agentId, heard.add(reason));
  return isNew;
}

// Stores the skip's row and tells the owner of a new reason in a row; the order stays as it is.
async function skip(parts: OrderFillsParts, state: FillState, skipped: Skip): Promise<FillOutcome> {
  const { order, reason, intent, signal } = skipped;
  const atMs = parts.clock.now();
  const row = {
    id: parts.ids.next("fil"),
    orderId: order.id,
    ...(intent === undefined ? {} : { intentId: intent.record.id }),
    outcome: "skipped" as const,
    reason,
    atMs,
  };
  await parts.orders.recordFill(row, { signal });
  if (shouldTell(state, skipped)) {
    const cap = await capOf(parts, skipped);
    parts.publish(
      noticePush(skippedNotice(order, cap === undefined ? { reason } : { reason, cap })),
    );
  }
  return "skipped";
}

// The fill's check at `simulated`: its order as it stands now, held to every bound with its quote.
function checkOf(
  parts: OrderFillsParts,
  fill: { readonly order: OrderRecord; readonly sized: SizedFill; readonly price: FillPrice },
): FillProposal["check"] {
  return async (simulated, { signal }) => {
    const { order, sized, price } = fill;
    const current = await parts.orders.get(order.id, { signal });
    const { quote } = simulated.record;
    if (current === undefined || quote === undefined) {
      return "order_inactive";
    }
    const view = quoteDocument.decode(quote);
    const other = order.request.side === "buy" ? view.amountIn.asset : view.minOut.asset;
    const usd = await parts.prices.usdPrice(other, { signal });
    const { maxSlippageBps } = sized.request;
    const checked = checkFill(
      current,
      {
        amountInBase: view.amountIn.base,
        expectedOutBase: view.expectedOut.base,
        minOutBase: view.minOut.base,
      },
      {
        nowMs: parts.clock.now(),
        limitBase: sized.limitBase,
        tokenDecimals: price.decimals,
        ...(maxSlippageBps === undefined ? {} : { maxSlippageBps }),
        ...(usd.ok && isUsablePrice(usd.value) ? { otherUsd: usd.value } : {}),
        ...(price.confirm === undefined ? {} : { confirm: price.confirm }),
      },
    );
    return checked.ok ? undefined : checked.error;
  };
}

// The reason a fill's intent ended without filling; `undefined` for a stop's cancel, which is no
// skip, and a fill that went on.
function endReasonOf(snapshot: IntentSnapshot): OrderFillReason | undefined {
  const { record, settings } = snapshot;
  if (record.state === "cancelled") {
    return settings.agent.frozenAtMs === undefined ? undefined : "frozen";
  }
  return record.state === "confirmed" ? "no_price" : record.reason;
}

// What the fill's intent came to: a paper fill, told to the owner, or a skip with its reason.
async function settle(
  parts: OrderFillsParts,
  state: FillState,
  run: {
    readonly order: OrderRecord;
    readonly rows: readonly OrderFillRecord[];
    readonly price: FillPrice;
    readonly snapshot: IntentSnapshot;
    readonly signal: AbortSignal;
  },
): Promise<FillOutcome> {
  const { order, rows, price, snapshot, signal } = run;
  const fill = paperFillOf(snapshot.history);
  if (snapshot.record.state === "paper_filled" && fill?.soldPrice !== undefined) {
    state.told.delete(order.agentId);
    parts.publish(
      noticePush(fillNotice(order, { ...fill, soldPrice: fill.soldPrice }, price.decimals)),
    );
    return "filled";
  }
  // A paper fill no price could value stays `confirmed`; a fill never waits for one.
  if (snapshot.record.state === "confirmed") {
    await cancelCard(parts, snapshot.record.id, signal);
  }
  const reason = endReasonOf(snapshot);
  return reason === undefined
    ? "inactive"
    : skip(parts, state, { order, rows, reason, intent: snapshot, signal });
}

// A gate a fill meets before any intent: a live order while live fills are off, a locked engine.
function gateOf(parts: OrderFillsParts, order: OrderRecord): OrderFillReason | undefined {
  if (!order.isPaper && !parts.liveFills) {
    return "live_fills_off";
  }
  return parts.isLocked() ? "engine_locked" : undefined;
}

async function fillNow(
  parts: OrderFillsParts,
  state: FillState,
  request: {
    readonly order: OrderRecord;
    readonly rows: readonly OrderFillRecord[];
    readonly price: FillPrice;
    readonly signal: AbortSignal;
  },
): Promise<FillOutcome> {
  const { order, rows, price, signal } = request;
  const gated = gateOf(parts, order);
  if (gated !== undefined) {
    return skip(parts, state, { order, rows, reason: gated, signal });
  }
  const settings = await parts.agents.get(order.agentId, { signal });
  if (settings === undefined) {
    return "inactive";
  }
  const sizing = { order, settings, tokenUsd: price.usdPerBaseUnit, signal };
  const sized = await sizeFill(parts, sizing);
  if (sized.kind === "empty") {
    await endEmptyExit(parts, { order, nowMs: parts.clock.now(), signal });
    return "ended";
  }
  if (sized.kind === "skip") {
    return skip(parts, state, { order, rows, reason: sized.reason, signal });
  }
  const proposer = {
    role: "engine",
    ref: "engine",
    hasOutsideContent: order.hasOutsideContent,
  } as const;
  const fill = {
    authorization: { order: order.id },
    isPaper: order.isPaper,
    check: checkOf(parts, { order, sized, price }),
  };
  const proposed = await parts.moneyPath.propose(sized.request, proposer, { signal, fill });
  if (!proposed.ok) {
    return skip(parts, state, { order, rows, reason: "no_route", signal });
  }
  return settle(parts, state, { order, rows, price, snapshot: proposed.value, signal });
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
            ? fillNow(parts, state, { order, rows, price, signal })
            : "inactive";
        });
      } finally {
        state.running.delete(id);
      }
    },
  };
}
