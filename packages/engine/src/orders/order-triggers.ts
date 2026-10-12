import type { AssetRef } from "@binference/chain";
import type { Clock, Id, Ratio } from "@binference/core";
import type { FillPrice, OrderFills } from "./fill-orders.js";
import { moveOrder } from "./order-machine.js";
import { hasPriceTrigger, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import { wholeTokenPrice } from "./price-level.js";
import { judgeTrigger, type TriggerState, triggerStateDocument } from "./price-triggers.js";

/** One confirmed price of a watched token, as the price watcher read it at a block. */
export interface WatchedOrderPrice {
  readonly token: AssetRef;
  /** Micro-dollars for one base unit of the token, exact. */
  readonly usdPerBaseUnit: Ratio;
  readonly decimals: number;
  /** A pool under $25,000 deep priced it, so a fill's own quote must meet the trigger too. */
  readonly isThin: boolean;
}

/** What one order's trigger came to on a price: no fire, or its fill's outcome. */
interface TriggerOutcome {
  readonly order: Id<"ord">;
  readonly outcome: Awaited<ReturnType<OrderFills["run"]>>;
}

/**
 * The price triggers (decision 0196): each confirmed price of a watched token judges the active
 * limit, take-profit, stop-loss and trailing orders on it, and an order whose trigger the price
 * meets hands its fill to the order fills in the same block's processing.
 */
export interface OrderTriggers {
  /**
   * Judges the active orders on a price's token and fills those it triggers; answers each fill's
   * outcome once it ended. A trailing stop's new highest price is kept in its order first.
   */
  see(
    price: WatchedOrderPrice,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly TriggerOutcome[]>;
}

/** What the triggers read the orders from and hand their fills to. */
export interface OrderTriggersParts {
  readonly orders: OrderStore;
  readonly fills: OrderFills;
  readonly clock: Clock;
}

// The active orders are read again at most this often; each move a trigger makes updates them.
const activeEveryMs = 1_000;
// How many active orders one read takes: more than an install holds.
const activeLimit = 1_000;

/** The active orders as last read, which the triggers judge prices against. */
interface ActiveOrders {
  /** The active orders on a token with a price trigger, read again once a second has passed. */
  on(token: AssetRef, signal: AbortSignal): Promise<readonly OrderRecord[]>;
  /** An order as a write left it. */
  kept(order: OrderRecord): void;
  /** Reads the orders again before the next price: a fill or a lost write moved them. */
  forget(): void;
}

function createActiveOrders(parts: OrderTriggersParts): ActiveOrders {
  const byId = new Map<Id<"ord">, OrderRecord>();
  const read: { atMs?: number } = {};
  return {
    async on(token, signal) {
      const nowMs = parts.clock.now();
      if (read.atMs === undefined || nowMs - read.atMs >= activeEveryMs) {
        const query = { states: ["active" as const], limit: activeLimit };
        const listed = await parts.orders.list(query, { signal });
        byId.clear();
        listed.forEach((order) => byId.set(order.id, order));
        read.atMs = nowMs;
      }
      return [...byId.values()].filter(
        (order) => order.request.token === token && hasPriceTrigger(order.kind),
      );
    },
    kept(order) {
      byId.set(order.id, order);
    },
    forget() {
      delete read.atMs;
    },
  };
}

// Keeps what a trigger keeps between prices, a new peak or the order armed again; a write another
// write beat is judged again later.
async function keepState(
  parts: OrderTriggersParts,
  active: ActiveOrders,
  call: { readonly order: OrderRecord; readonly state: TriggerState; readonly signal: AbortSignal },
): Promise<void> {
  const { order, state, signal } = call;
  const triggerState = triggerStateDocument.encode(state);
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  const [kept] = written?.ok === true ? written.value : [];
  if (kept === undefined) {
    active.forget();
    return;
  }
  active.kept(kept);
}

async function judge(
  parts: OrderTriggersParts,
  active: ActiveOrders,
  call: {
    readonly order: OrderRecord;
    readonly price: WatchedOrderPrice;
    readonly signal: AbortSignal;
  },
): Promise<TriggerOutcome | undefined> {
  const { order, price, signal } = call;
  const judged = judgeTrigger(order, wholeTokenPrice(price.usdPerBaseUnit, price.decimals));
  if (judged?.state !== undefined) {
    await keepState(parts, active, { order, state: judged.state, signal });
  }
  if (judged?.fires !== true) {
    return undefined;
  }
  const { usdPerBaseUnit, decimals } = price;
  const fillPrice: FillPrice = price.isThin
    ? { usdPerBaseUnit, decimals, confirm: judged.level }
    : { usdPerBaseUnit, decimals };
  const outcome = await parts.fills.run({ order: order.id, price: fillPrice }, { signal });
  if (outcome === "filled" || outcome === "ended") {
    active.forget();
  }
  return { order: order.id, outcome };
}

/** Creates the {@link OrderTriggers} over the order store and the order fills. */
export function createOrderTriggers(parts: OrderTriggersParts): OrderTriggers {
  const active = createActiveOrders(parts);
  return {
    async see(price, { signal }) {
      const orders = await active.on(price.token, signal);
      const outcomes = await Promise.all(
        orders.map(async (order) => judge(parts, active, { order, price, signal })),
      );
      return outcomes.filter((outcome) => outcome !== undefined);
    },
  };
}
