import type { CandleInterval } from "@binference/plugin-sdk";
import type { OhlcvTimeframe } from "./api/geckoterminal-api.js";

/** A candle width as GeckoTerminal's OHLCV endpoint names it: a timeframe and an aggregate. */
export interface CandleFrame {
  readonly timeframe: OhlcvTimeframe;
  readonly aggregate: number;
}

// Each interval of a chart, among the aggregates the docs list for each timeframe.
const frames: Readonly<Record<CandleInterval, CandleFrame>> = {
  "1m": { timeframe: "minute", aggregate: 1 },
  "5m": { timeframe: "minute", aggregate: 5 },
  "15m": { timeframe: "minute", aggregate: 15 },
  "1h": { timeframe: "hour", aggregate: 1 },
  "4h": { timeframe: "hour", aggregate: 4 },
  "1d": { timeframe: "day", aggregate: 1 },
};

/** The OHLCV timeframe and aggregate of a chart's interval. */
export function frameOf(interval: CandleInterval): CandleFrame {
  return frames[interval];
}
