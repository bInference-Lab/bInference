import type { Ratio } from "@binference/core";

/** A chart's candle width: one, five or fifteen minutes, one or four hours, or a day. */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

/** Every {@link CandleInterval}, shortest first. */
export const candleIntervals: readonly CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

/**
 * One OHLCV candle of a token in USD, as a market data source reports it. Its figures inform the
 * owner and the agent and never price a trade.
 */
export interface MarketCandle {
  /** When the candle starts, in epoch milliseconds. */
  readonly atMs: number;
  /** USD for one whole token when the candle opens, exactly as the source wrote it. */
  readonly open: Ratio;
  /** The highest USD for one whole token in the candle. */
  readonly high: Ratio;
  /** The lowest USD for one whole token in the candle. */
  readonly low: Ratio;
  /** USD for one whole token when the candle closes. */
  readonly close: Ratio;
  /** What the token traded in the candle, in micro-dollars, rounded down. */
  readonly volumeUsdMicros: bigint;
}

/** Which candles of a token a chart asks for: the newest `limit` that start before `beforeMs`. */
export interface CandleRequest {
  readonly interval: CandleInterval;
  /** The candles start before this time, in epoch milliseconds; up to now when absent. */
  readonly beforeMs?: number;
  /** How many candles, from the newest back: at least 1, and at most what the source reads at once. */
  readonly limit: number;
}
