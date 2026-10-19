import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  type CandleInterval,
  candleIntervals,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { z } from "zod";
import { type ScanFilter, scanFilterSchema } from "../views/launch-filter.schema.js";

/**
 * The fields an agent's market tools build their terms from (runtime spec, section 5.1): a chain,
 * a token, an account, a candle width and the launch filter of a scan. Each tool adds its own page
 * size and times, as the model writes them.
 */
export interface MarketTermFields {
  readonly chain: z.ZodType<ChainRef>;
  readonly asset: z.ZodType<AssetRef>;
  readonly account: z.ZodType<AccountRef>;
  readonly interval: z.ZodType<CandleInterval>;
  readonly scanFilter: z.ZodType<ScanFilter>;
}

/** The schemas of {@link MarketTermFields}, the same the market operations parse their args by. */
export const marketTermFields: MarketTermFields = {
  chain: chainRefSchema,
  asset: assetRefSchema,
  account: accountRefSchema,
  interval: z.enum(candleIntervals),
  scanFilter: scanFilterSchema,
};
