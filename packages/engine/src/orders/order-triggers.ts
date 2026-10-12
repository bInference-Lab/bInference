import type { AssetRef } from "@binference/chain";
import type { Clock, Id, Ratio } from "@binference/core";
import type { FillPrice, OrderFills } from "./fill-orders.js";
import { moveOrder } from "./order-machine.js";
import { hasPriceTrigger, type OrderRecord } from "./order-record.js";
import type { OrderStore } from "./ports.js";
import { type PriceLevel, wholeTokenPrice } from "./price-level.js";
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
// How many active orders one page of the read takes.
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

// Every active order, page after page until a page comes back empty, so a store that answers
// fewer than asked still hands over all of them (decision 0197).
async function allActive(
  parts: OrderTriggersParts,
  signal: AbortSignal,
  after?: { readonly createdAtMs: number; readonly id: Id<"ord"> },
): Promise<readonly OrderRecord[]> {
  const query = { states: ["active" as const], limit: activeLimit };
  const page = await parts.orders.list(after === undefined ? query : { ...query, after }, {
    signal,
  });
  const last = page.at(-1);
  if (last === undefined) {
    return page;
  }
  const cursor = { createdAtMs: last.createdAtMs, id: last.id };
  return [...page, ...(await allActive(parts, signal, cursor))];
}

function createActiveOrders(parts: OrderTriggersParts): ActiveOrders {
  const byId = new Map<Id<"ord">, OrderRecord>();
  const read: { atMs?: number } = {};
  return {
    async on(token, signal) {
      const nowMs = parts.clock.now();
      if (read.atMs === undefined || nowMs - read.atMs >= activeEveryMs) {
        const listed = await allActive(parts, signal);
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

// A write of what a trigger keeps that loses its race reads the order again this many times.
const keepAttempts = 2;

// Keeps what a trigger keeps between prices, a new peak or the order armed again, and answers the
// order as it stands after. A write another write beat reads the order again and judges the same
// price on what it then keeps, so a higher peak is never lost (decision 0197).
async function keepState(
  parts: OrderTriggersParts,
  active: ActiveOrders,
  call: {
    readonly order: OrderRecord;
    readonly state: TriggerState;
    readonly signal: AbortSignal;
  },
): Promise<OrderRecord | undefined> {
  const { order, state, signal } = call;
  const triggerState = triggerStateDocument.encode(state);
  const move = moveOrder(order, { type: "trigger_kept", triggerState }, parts.clock.now());
  const written = move.ok ? await parts.orders.move([move.value], { signal }) : undefined;
  const [kept] = written?.ok === true ? written.value : [];
  if (kept !== undefined) {
    active.kept(kept);
  }
  return kept;
}

// A limit or take-profit fill holds its order's level at its own quote whatever the pool's depth;
// a stop-loss or a trailing stop, which must sell, only after a thin pool's price (decision 0197).
function holdsLevelAtFill(order: OrderRecord): boolean {
  return order.kind === "limit" || order.kind === "takeProfit";
}

// Judges one order on one price; a lost write of its kept state is judged again on the order read
// back. Answers the fill's price when the order fires.
async function judgeOrder(
  parts: OrderTriggersParts,
  active: ActiveOrders,
  call: {
    readonly order: OrderRecord;
    readonly price: WatchedOrderPrice;
    readonly signal: AbortSignal;
    readonly left: number;
  },
): Promise<FillPrice | undefined> {
  const { order, price, signal, left } = call;
  const judged = judgeTrigger(order, wholeTokenPrice(price.usdPerBaseUnit, price.decimals));
  const kept =
    judged?.state === undefined
      ? order
      : await keepState(parts, active, { order, state: judged.state, signal });
  if (kept === undefined) {
    const again = left > 1 ? await parts.orders.get(order.id, { signal }) : undefined;
    return again?.state === "active"
      ? judgeOrder(parts, active, { ...call, order: again, left: left - 1 })
      : undefined;
  }
  return judged?.fires === true ? fillPriceOf(order, price, judged.level) : undefined;
}

// The price a fill runs at, with the level its own quote must meet when it must.
function fillPriceOf(order: OrderRecord, price: WatchedOrderPrice, level: PriceLevel): FillPrice {
  const { usdPerBaseUnit, decimals } = price;
  return price.isThin || holdsLevelAtFill(order)
    ? { usdPerBaseUnit, decimals, confirm: level }
    : { usdPerBaseUnit, decimals };
}

// Judges the active orders on a price's token one after the other, and answers those that fire.
async function judgeAll(
  parts: OrderTriggersParts,
  active: ActiveOrders,
  call: { readonly price: WatchedOrderPrice; readonly signal: AbortSignal },
): Promise<readonly { readonly order: Id<"ord">; readonly price: FillPrice }[]> {
  const { price, signal } = call;
  const orders = await active.on(price.token, signal);
  type Fired = readonly { readonly order: Id<"ord">; readonly price: FillPrice }[];
  // One order after the other: each writes its own kept state under the version it read.
  return orders.reduce<Promise<Fired>>(async (done, order) => {
    const fired = await done;
    const fillPrice = await judgeOrder(parts, active, { order, price, signal, left: keepAttempts });
    return fillPrice === undefined ? fired : [...fired, { order: order.id, price: fillPrice }];
  }, Promise.resolve([]));
}

/**
 * Creates the {@link OrderTriggers} over the order store and the order fills. One token's prices
 * are judged one at a time, in the order they came, so a trailing stop sees every peak; the fills
 * they start run on their own (decision 0197).
 */
export function createOrderTriggers(parts: OrderTriggersParts): OrderTriggers {
  const active = createActiveOrders(parts);
  const lines = new Map<AssetRef, Promise<void>>();
  const inLine = async <T>(token: AssetRef, work: () => Promise<T>): Promise<T> => {
    const before = lines.get(token) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    lines.set(token, tail);
    try {
      return await run;
    } finally {
      if (lines.get(token) === tail) {
        lines.delete(token);
      }
    }
  };
  return {
    async see(price, { signal }) {
      const fired = await inLine(price.token, async () =>
        judgeAll(parts, active, { price, signal }),
      );
      return Promise.all(
        fired.map(async ({ order, price: fillPrice }) => {
          const outcome = await parts.fills.run({ order, price: fillPrice }, { signal });
          if (outcome === "filled" || outcome === "ended") {
            active.forget();
          }
          return { order, outcome };
        }),
      );
    },
  };
}
