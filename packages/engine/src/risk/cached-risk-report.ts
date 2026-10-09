import {
  type AssetRef,
  assetRefSchema,
  riskFlagCodes,
  type TokenRiskReport,
} from "@binference/chain";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";

/** Which answer the risk cache holds: one source's, for one token. */
export interface RiskCacheKey {
  readonly asset: AssetRef;
  /** The source's id, such as one the `risk_cache` table names. */
  readonly source: string;
}

/** A source's report for a token, and when the source gave it. */
export interface CachedRiskReport extends RiskCacheKey {
  readonly report: TokenRiskReport;
  readonly fetchedAtMs: number;
}

const keyShape = {
  asset: assetRefSchema,
  source: z.string().regex(/^[a-z][a-z0-9_]*$/),
};

// The report as it crosses the store worker's boundary, liquidity as a bigint.
const reportSchema: z.ZodType<TokenRiskReport> = z.strictObject({
  flags: z.array(z.enum(riskFlagCodes)),
  liquidityUsdMicros: z.bigint().nonnegative().exactOptional(),
});

/** Parses a cache key. */
export const riskCacheKeySchema: z.ZodType<RiskCacheKey> = z.strictObject(keyShape);

/** Parses a cached report as it crosses the store worker's boundary. */
export const cachedRiskReportSchema: z.ZodType<CachedRiskReport> = z.strictObject({
  ...keyShape,
  report: reportSchema,
  fetchedAtMs: epochMsSchema,
});
