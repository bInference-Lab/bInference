import { type AssetRef, assetRefSchema, type CandleInterval } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type LaunchpadId, launchpadIdSchema } from "./launch-filter.schema.js";
import { type RiskView, riskViewSchema } from "./risk-view.schema.js";

/**
 * One token of `market/scan` (spec 1, section 7.3): a new launch or a trending token, with the
 * figures its source gives. Prices are micro-dollars for 10^`priceScale` whole tokens (decision
 * 0184); fields the source does not give are absent.
 */
export interface ScanItem {
  readonly asset: AssetRef;
  readonly launchpad?: LaunchpadId;
  readonly launchedAt?: number;
  /** Micro-dollars for 10^`priceScale` whole tokens, rounded down. */
  readonly priceUsdMicros?: bigint;
  /** How many whole tokens the price is for, as a power of ten: 1 to 18, absent for one. */
  readonly priceScale?: number;
  readonly liquidityUsdMicros?: bigint;
  readonly volume24hUsdMicros?: bigint;
  /** The price change over 24 hours, in signed basis points. */
  readonly change24hBps?: number;
  readonly curveProgressBps?: Bps;
  readonly graduated?: boolean;
  /** The boosts bought for the token that are active now, where its source ranks by them. */
  readonly activeBoosts?: number;
  /** Present only when the risk cache holds a fresh answer: a scan calls no risk source. */
  readonly risk?: RiskView;
}

/** One OHLCV candle of `market/chart`, its prices for 10^`priceScale` whole tokens. */
export interface CandleView {
  /** When the candle starts. */
  readonly at: number;
  readonly openUsdMicros: bigint;
  readonly highUsdMicros: bigint;
  readonly lowUsdMicros: bigint;
  readonly closeUsdMicros: bigint;
  /** What traded in the candle, in micro-dollars. */
  readonly volumeUsdMicros: bigint;
}

/** The answer of `market/chart`: the candles, oldest first, and the data source they came from. */
export interface ChartView {
  readonly asset: AssetRef;
  readonly interval: CandleInterval;
  readonly candles: readonly CandleView[];
  /** How many whole tokens the candles' prices are for, as a power of ten; absent for one. */
  readonly priceScale?: number;
  /** The data source's registry id. */
  readonly source: string;
}

/** Parses a price scale: 1 to 18; a scale of 0 is written as no field. */
export const priceScaleSchema: z.ZodType<number> = z.int().min(1).max(18);

/** Parses a data source's registry id. */
export const sourceIdSchema: z.ZodType<string> = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/** Parses one item of a market scan. */
export const scanItemSchema: z.ZodType<ScanItem> = z.object({
  asset: assetRefSchema,
  launchpad: launchpadIdSchema.exactOptional(),
  launchedAt: epochMsSchema.exactOptional(),
  priceUsdMicros: decimalStringSchema.exactOptional(),
  priceScale: priceScaleSchema.exactOptional(),
  liquidityUsdMicros: decimalStringSchema.exactOptional(),
  volume24hUsdMicros: decimalStringSchema.exactOptional(),
  change24hBps: z.int().exactOptional(),
  curveProgressBps: bpsSchema.exactOptional(),
  graduated: z.boolean().exactOptional(),
  activeBoosts: z.int().nonnegative().exactOptional(),
  risk: riskViewSchema.exactOptional(),
});

/** Parses one candle of a chart. */
export const candleViewSchema: z.ZodType<CandleView> = z.object({
  at: epochMsSchema,
  openUsdMicros: decimalStringSchema,
  highUsdMicros: decimalStringSchema,
  lowUsdMicros: decimalStringSchema,
  closeUsdMicros: decimalStringSchema,
  volumeUsdMicros: decimalStringSchema,
});
