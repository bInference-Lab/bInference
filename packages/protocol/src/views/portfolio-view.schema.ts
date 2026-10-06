import { type Amount, type AssetRef, amountSchema, assetRefSchema } from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { signedUsdMicrosSchema } from "../values/signed-usd-micros.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";

/** A wallet's balance of one asset and its value, when a price is known. */
export interface BalanceView {
  readonly wallet: ProtocolId<"wallet">;
  readonly amount: Amount;
  readonly usdMicros?: bigint;
  readonly paper: boolean;
}

/**
 * A position at average cost: what the wallet holds of an asset, what it paid with fees and gas,
 * and the profit or loss, below zero for a loss.
 */
export interface PositionView {
  readonly wallet: ProtocolId<"wallet">;
  readonly asset: AssetRef;
  readonly quantity: bigint;
  readonly costUsdMicros: bigint;
  readonly realizedUsdMicros: bigint;
  /** Absent when no price is known. */
  readonly unrealizedUsdMicros?: bigint;
  readonly paper: boolean;
}

/** Balances, their dollar values, positions and profit or loss of one agent, wallet or all. */
export interface PortfolioView {
  readonly balances: readonly BalanceView[];
  readonly positions: readonly PositionView[];
  /** The sum of the balances with a known price. */
  readonly totalUsdMicros: bigint;
  readonly assets: AssetInfos;
}

/** Parses a portfolio view. */
export const portfolioViewSchema: z.ZodType<PortfolioView> = z.object({
  balances: z.array(
    z.object({
      wallet: protocolIdSchema("wallet"),
      amount: amountSchema,
      usdMicros: decimalStringSchema.exactOptional(),
      paper: z.boolean(),
    }),
  ),
  positions: z.array(
    z.object({
      wallet: protocolIdSchema("wallet"),
      asset: assetRefSchema,
      quantity: decimalStringSchema,
      costUsdMicros: decimalStringSchema,
      realizedUsdMicros: signedUsdMicrosSchema,
      unrealizedUsdMicros: signedUsdMicrosSchema.exactOptional(),
      paper: z.boolean(),
    }),
  ),
  totalUsdMicros: decimalStringSchema,
  assets: assetInfosSchema,
});
