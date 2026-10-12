export type { MarketAnswer, MarketReadFailure } from "./market/market-answer.js";
export type { MarketReads } from "./market/ports.js";
export { createSourceMarketReads } from "./market/source-market-reads.js";
export type { SourceMarketReadsOptions } from "./market/source-market-reads.js";
export { createPriceCrossCheck, gapBpsOf } from "./market/price-cross-check.js";
export type {
  CrossCheckSource,
  PriceCheck,
  PriceCrossCheck,
  PriceCrossCheckOptions,
  PriceSample,
} from "./market/price-cross-check.js";
export {
  createWatcherLagAlerts,
  watcherLagNoticeKey,
  watcherStateOf,
} from "./market/watcher-lag.js";
export type {
  WatcherHealth,
  WatcherLagAlerts,
  WatcherLagReading,
  WatcherState,
} from "./market/watcher-lag.js";
