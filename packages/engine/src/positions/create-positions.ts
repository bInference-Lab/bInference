import { mulDiv, type Result } from "@binference/core";
import type { PositionStore, PriceSource, UsdPrice } from "../ports.js";
import { applyArrival } from "./apply-arrival.js";
import { applyExecution } from "./apply-execution.js";
import type { ArrivalDraft, ArrivalRecord } from "./arrival-record.js";
import type { ExecutionRecord } from "./execution-record.js";
import type { PositionQuery, PositionRecord } from "./position-record.js";
import { type ExecutedTrade, valueExecution } from "./value-execution.js";

/**
 * A position with what it is worth now. A position that holds nothing is worth 0; one whose asset
 * has no price has neither value nor unrealized P&L.
 */
export interface ValuedPosition {
  readonly position: PositionRecord;
  /** The units held at today's price, rounded down so a value is never overstated. */
  readonly valueUsdMicros?: bigint;
  /** The value minus the cost of the units held; below zero for a loss. */
  readonly unrealizedUsdMicros?: bigint;
}

/**
 * The positions of the money path: what each execution and arrival moves, and what the positions
 * are worth.
 */
export interface Positions {
  /**
   * Values a trade at the prices of its time and stores it with the position changes it makes.
   * `stale` means another execution moved one of the positions first: nothing was stored, and a
   * new call reads the positions again.
   */
  record(
    trade: ExecutedTrade,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ExecutionRecord, "stale">>;
  /**
   * Values funds that arrived without a trade at the `PriceSource`'s price now, rounded up as
   * every value at the time is, and stores them with the position they open. Call it when the
   * funds arrive, so the price is the one of their arrival.
   *
   * No usable price (`no_price`, or a zero or malformed price) stores the arrival without a value,
   * and it opens no position: a later sale of those units counts no gain or loss, and a later
   * price never values them after the fact. `stale` as for `record`.
   */
  receive(
    arrival: Omit<ArrivalDraft, "valueUsdMicros">,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<ArrivalRecord, "stale">>;
  /** One wallet's positions with their value and unrealized P&L at the `PriceSource`'s price. */
  value(
    query: PositionQuery,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly ValuedPosition[]>;
}

/** The ports positions are stored in and priced through. */
export interface PositionsOptions {
  readonly store: PositionStore;
  readonly prices: PriceSource;
}

// A zero or malformed price would value a position at nothing, so it counts as no price.
const isUsable = (price: UsdPrice): boolean => price.numerator > 0n && price.denominator > 0n;

async function valueOne(
  position: PositionRecord,
  prices: PriceSource,
  signal: AbortSignal,
): Promise<ValuedPosition> {
  // Nothing held costs nothing, so it needs no price.
  if (position.quantityBase === 0n) {
    return { position, valueUsdMicros: 0n, unrealizedUsdMicros: 0n };
  }
  const price = await prices.usdPrice(position.asset, { signal });
  if (!price.ok || !isUsable(price.value)) {
    return { position };
  }
  const valueUsdMicros = mulDiv(position.quantityBase, price.value, "down");
  return { position, valueUsdMicros, unrealizedUsdMicros: valueUsdMicros - position.costUsdMicros };
}

/** Creates {@link Positions} over a position store and a price source. */
export function createPositions(options: PositionsOptions): Positions {
  const { store, prices } = options;
  return {
    async record(trade, call) {
      const execution = valueExecution(trade);
      const query = { walletId: trade.walletId, isPaper: trade.isPaper };
      const held = await store.positions(query, call);
      return store.record({ execution, positions: applyExecution(held, execution) }, call);
    },
    async receive(funds, call) {
      const price = await prices.usdPrice(funds.received.asset, call);
      const arrival =
        price.ok && isUsable(price.value)
          ? { ...funds, valueUsdMicros: mulDiv(funds.received.base, price.value, "up") }
          : funds;
      const held = await store.positions(
        { walletId: funds.walletId, isPaper: funds.isPaper },
        call,
      );
      return store.recordArrival({ arrival, positions: applyArrival(held, arrival) }, call);
    },
    async value(query, call) {
      const held = await store.positions(query, call);
      return Promise.all(held.map(async (position) => valueOne(position, prices, call.signal)));
    },
  };
}
