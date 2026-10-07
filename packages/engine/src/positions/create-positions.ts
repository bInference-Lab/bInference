import type { Amount } from "@binference/chain";
import { err, type Id, mulDiv, type Result } from "@binference/core";
import type { PositionStore, PriceSource } from "../ports.js";
import { applyArrival } from "./apply-arrival.js";
import { applyExecution } from "./apply-execution.js";
import type { ArrivalDraft, ArrivalRecord } from "./arrival-record.js";
import type { ExecutionRecord } from "./execution-record.js";
import { paperResetOf } from "./paper-reset-of.js";
import type { PositionQuery, PositionRecord } from "./position-record.js";
import { type ExecutedTrade, isUsablePrice, valueExecution } from "./value-execution.js";

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
  /**
   * Starts a wallet's paper portfolio again from `balances`, one per asset, at the
   * `PriceSource`'s prices now: every paper position of the wallet empties, and each balance
   * arrives at its value, rounded up, and opens its position. A paper portfolio holds its balances
   * as positions, so a balance with no usable price is `no_price` and nothing is stored. `stale`
   * as for `record`.
   */
  resetPaper(
    reset: {
      readonly walletId: Id<"wal">;
      readonly atMs: number;
      readonly balances: readonly Amount[];
    },
    options: { readonly signal: AbortSignal },
  ): Promise<Result<readonly ArrivalRecord[], "no_price" | "stale">>;
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
  if (!price.ok || !isUsablePrice(price.value)) {
    return { position };
  }
  const valueUsdMicros = mulDiv(position.quantityBase, price.value, "down");
  return { position, valueUsdMicros, unrealizedUsdMicros: valueUsdMicros - position.costUsdMicros };
}

type PaperResetCall = Parameters<Positions["resetPaper"]>[0];

// Every balance is priced before anything is stored, so a missing price leaves the wallet as it was.
async function resetPaper(
  options: PositionsOptions,
  { walletId, atMs, balances }: PaperResetCall,
  signal: AbortSignal,
): Promise<Result<readonly ArrivalRecord[], "no_price" | "stale">> {
  const priced = await Promise.all(
    balances.map(async (received) => ({
      received,
      price: await options.prices.usdPrice(received.asset, { signal }),
    })),
  );
  const arrivals: ArrivalDraft[] = [];
  for (const { received, price } of priced) {
    if (!price.ok || !isUsablePrice(price.value)) {
      return err("no_price");
    }
    const valueUsdMicros = mulDiv(received.base, price.value, "up");
    arrivals.push({ walletId, isPaper: true, atMs, received, valueUsdMicros });
  }
  const held = await options.store.positions({ walletId, isPaper: true }, { signal });
  return options.store.resetPaper(paperResetOf({ walletId, atMs, held, arrivals }), { signal });
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
        price.ok && isUsablePrice(price.value)
          ? { ...funds, valueUsdMicros: mulDiv(funds.received.base, price.value, "up") }
          : funds;
      const held = await store.positions(
        { walletId: funds.walletId, isPaper: funds.isPaper },
        call,
      );
      return store.recordArrival({ arrival, positions: applyArrival(held, arrival) }, call);
    },
    resetPaper: async (reset, call) => resetPaper(options, reset, call.signal),
    async value(query, call) {
      const held = await store.positions(query, call);
      return Promise.all(held.map(async (position) => valueOne(position, prices, call.signal)));
    },
  };
}
