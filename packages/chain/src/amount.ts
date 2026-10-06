import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type AssetRef, assetRefSchema } from "./caip/asset-ref.js";

/**
 * An amount of one asset in base units. Decimals come from the asset's definition; math lives in
 * core and display in i18n.
 */
export interface Amount {
  readonly asset: AssetRef;
  readonly base: bigint;
}

/** An {@link Amount} as JSON carries it: the base units as a decimal string. */
export interface AmountWire {
  readonly asset: string;
  readonly base: string;
}

/** Decodes an amount from JSON, and encodes it back with `z.encode`. */
export const amountSchema: z.ZodType<Amount, AmountWire> = z.strictObject({
  asset: assetRefSchema,
  base: decimalStringSchema,
});
