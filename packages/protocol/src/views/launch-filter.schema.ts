import { type AssetRef, assetRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";

/** A launchpad venue's registry id; the engine refuses one the registry does not list. */
export type LaunchpadId = string;

/** Parses a launchpad venue's id, in the form registry venue ids take. */
export const launchpadIdSchema: z.ZodType<LaunchpadId> = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);

/**
 * Which launches pass (spec 1, section 8.4): every field given must hold, and an empty filter
 * passes every launch. `launch/list`, `market/scan` and launch alerts take it.
 */
export interface LaunchFilter {
  readonly launchpads?: readonly LaunchpadId[];
  readonly quoteTokens?: readonly AssetRef[];
  readonly maxTaxBps?: Bps;
  readonly maxSnipeTaxBps?: Bps;
  readonly minCurveProgressBps?: Bps;
  readonly minLiquidityUsdMicros?: bigint;
  readonly maxInsiders?: number;
  readonly maxCreatorLaunches30d?: number;
}

/**
 * The launch filter an agent's `market_scan` takes: a {@link LaunchFilter} without a least
 * liquidity, which no launch the feed reads passes (spec 1, section 7.3).
 */
export type ScanFilter = Omit<LaunchFilter, "minLiquidityUsdMicros">;

const count = z.int().nonnegative();

// Every field of a launch filter, in the order the protocol describes them.
const filterObject = z.strictObject({
  launchpads: z.array(launchpadIdSchema).min(1).max(16).exactOptional(),
  quoteTokens: z.array(assetRefSchema).min(1).max(20).exactOptional(),
  maxTaxBps: bpsSchema.exactOptional(),
  maxSnipeTaxBps: bpsSchema.exactOptional(),
  minCurveProgressBps: bpsSchema.exactOptional(),
  minLiquidityUsdMicros: decimalStringSchema.exactOptional(),
  maxInsiders: count.exactOptional(),
  maxCreatorLaunches30d: count.exactOptional(),
});

/** Parses a launch filter; unknown fields are refused, as in any args. */
export const launchFilterSchema: z.ZodType<LaunchFilter> = filterObject;

/** Parses the launch filter of an agent's market scan; unknown fields are refused. */
export const scanFilterSchema: z.ZodType<ScanFilter> = filterObject.omit({
  minLiquidityUsdMicros: true,
});
