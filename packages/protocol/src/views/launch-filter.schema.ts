import { type AssetRef, assetRefSchema } from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";

/** The launchpads of v1 whose launches the launch feed reads. */
export type LaunchpadId = "flap" | "fourmeme" | "geniusfun" | "brew";

/** Every {@link LaunchpadId}. */
export const launchpadIds: readonly LaunchpadId[] = ["flap", "fourmeme", "geniusfun", "brew"];

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

const count = z.int().nonnegative();

/** Parses a launch filter; unknown fields are refused, as in any args. */
export const launchFilterSchema: z.ZodType<LaunchFilter> = z.strictObject({
  launchpads: z.array(z.enum(launchpadIds)).min(1).max(launchpadIds.length).exactOptional(),
  quoteTokens: z.array(assetRefSchema).min(1).max(20).exactOptional(),
  maxTaxBps: bpsSchema.exactOptional(),
  maxSnipeTaxBps: bpsSchema.exactOptional(),
  minCurveProgressBps: bpsSchema.exactOptional(),
  minLiquidityUsdMicros: decimalStringSchema.exactOptional(),
  maxInsiders: count.exactOptional(),
  maxCreatorLaunches30d: count.exactOptional(),
});
