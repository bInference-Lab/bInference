import { type AssetRef, assetRefSchema } from "@binference/chain";
import { z } from "zod";
import { type RiskView, riskViewSchema } from "./risk-view.schema.js";

/**
 * What a client needs to show an asset. `symbol` and `name` are set by whoever deployed the token,
 * so clients escape them.
 */
export interface AssetInfo {
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  /** The asset is in the chain registry. */
  readonly verified: boolean;
  /** The token still trades on a launchpad's bonding curve. */
  readonly onCurve?: boolean;
  /** An image URL. */
  readonly logo?: string;
}

/** The assets a response mentions, each described once instead of beside every amount. */
export type AssetInfos = Readonly<Record<AssetRef, AssetInfo>>;

/** One asset with its info, and its risk when a check has run. */
export interface AssetView extends AssetInfo {
  readonly asset: AssetRef;
  readonly risk?: RiskView;
}

const assetInfoShape = {
  symbol: z.string(),
  name: z.string(),
  decimals: z.int().min(0).max(255),
  verified: z.boolean(),
  onCurve: z.boolean().exactOptional(),
  logo: z.string().exactOptional(),
};

/** Parses the `assets` of a response. */
export const assetInfosSchema: z.ZodType<AssetInfos> = z.record(
  assetRefSchema,
  z.object(assetInfoShape),
);

/** Parses an asset view. */
export const assetViewSchema: z.ZodType<AssetView> = z.object({
  asset: assetRefSchema,
  ...assetInfoShape,
  risk: riskViewSchema.exactOptional(),
});
