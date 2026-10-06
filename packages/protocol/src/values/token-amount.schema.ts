import { type Bps, bpsSchema, decimalStringSchema } from "@binference/core";
import { z } from "zod";

/** An amount in base units of the asset its request names beside it, such as a swap's `from`. */
export interface BaseUnits {
  readonly base: bigint;
}

/** A share of the wallet's balance of the asset, in basis points. */
export interface BalanceShare {
  readonly percentBps: Bps;
}

/** A value in micro-dollars. */
export interface UsdValue {
  readonly usdMicros: bigint;
}

/** How much of a token a swap or a sell spends: base units, or a share of the balance. */
export type TokenAmount = BaseUnits | BalanceShare;

/** The size of each fill of an auto order or webhook rule. */
export type FillSize = BaseUnits | UsdValue | BalanceShare;

const baseUnitsSchema = z.strictObject({ base: decimalStringSchema });
const balanceShareSchema = z.strictObject({ percentBps: bpsSchema });
const usdValueSchema = z.strictObject({ usdMicros: decimalStringSchema });

/** Parses a token amount: `{ base }` or `{ percentBps }`, never both. */
export const tokenAmountSchema: z.ZodType<TokenAmount> = z.union([
  baseUnitsSchema,
  balanceShareSchema,
]);

/** Parses a fill size: `{ base }`, `{ usdMicros }` or `{ percentBps }`, exactly one. */
export const fillSizeSchema: z.ZodType<FillSize> = z.union([
  baseUnitsSchema,
  usdValueSchema,
  balanceShareSchema,
]);
