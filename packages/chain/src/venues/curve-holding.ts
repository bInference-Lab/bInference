import { z } from "zod";
import type { AccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";

/**
 * What the venue host asks a launchpad: whether a token is on its bonding curve now. The
 * launchpad reads only its own contracts, which the host gives it by their names in the chain
 * registry, as for a quote.
 */
export interface CurveRequest {
  /** The token the agent buys or sells, on one of the launchpad's chains. */
  readonly token: AssetRef;
  /** The launchpad's declared contracts on the token's chain, by their names in the registry. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/**
 * Where a launchpad holds a token now. A token on its curve names the asset the curve trades it
 * against: the launchpad's quote token for it, or the chain's coin. A token that never launched
 * there, or that graduated to the pools, is not on its curve.
 */
export type CurveHolding =
  | { readonly onCurve: false }
  | { readonly onCurve: true; readonly quoteAsset: AssetRef };

/** A {@link CurveHolding} as JSON carries it. */
export type CurveHoldingWire =
  | { readonly onCurve: false }
  | { readonly onCurve: true; readonly quoteAsset: string };

/** Decodes a launchpad's answer, and encodes it back with `z.encode`. */
export const curveHoldingSchema: z.ZodType<CurveHolding, CurveHoldingWire> = z.discriminatedUnion(
  "onCurve",
  [
    z.strictObject({ onCurve: z.literal(false) }),
    z.strictObject({ onCurve: z.literal(true), quoteAsset: assetRefSchema }),
  ],
);
