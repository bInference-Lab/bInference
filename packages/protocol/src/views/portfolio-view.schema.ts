import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  type AssetRef,
  amountSchema,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";
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

/** Coin an unstake took out, and when a claim can take it. */
interface UnbondingView {
  readonly amount: Amount;
  readonly readyAt: number;
}

/**
 * What one wallet holds with one validator of a staking venue, in one mode (decision 0329): the
 * venue's receipt token units, what they are worth in the chain's coin now, the coin unstakes took
 * out that is not ready yet, and what a claim would take back now. The receipt units are a balance
 * of the view too, which counts their value once.
 */
interface StakingPositionView {
  readonly wallet: ProtocolId<"wallet">;
  readonly venue: string;
  readonly validator?: AccountRef;
  /** Absent when the venue could not be read, so its receipt token is not known. */
  readonly staked?: Amount;
  /** Absent when the venue's pool could not be read. */
  readonly stakedValue?: Amount;
  readonly unbonding: readonly UnbondingView[];
  readonly claimable: Amount;
  readonly paper: boolean;
}

/**
 * A bridge whose deposit is final and whose delivery no read found yet (decision 0297): what left
 * the wallet, at the value its units left their position with, the chain and account it pays,
 * since when, and whether it is late. Bridges are live only.
 */
interface InTransitView {
  readonly intent: ProtocolId<"intent">;
  readonly wallet: ProtocolId<"wallet">;
  readonly amount: Amount;
  readonly usdMicros?: bigint;
  readonly toChain: ChainRef;
  readonly recipient: AccountRef;
  readonly sentAt: number;
  readonly late: boolean;
}

/**
 * Balances, their dollar values, positions and profit or loss of one agent, wallet or all. Live
 * holdings come first, then paper ones, and the two are never added together.
 */
export interface PortfolioView {
  readonly balances: readonly BalanceView[];
  readonly positions: readonly PositionView[];
  /**
   * The sum of the live balances, unbonding coin and bridges in transit with a known value; a
   * paper one never counts.
   */
  readonly totalUsdMicros: bigint;
  /**
   * The sum of the paper balances and unbonding coin with a known value; absent when the view
   * holds none.
   */
  readonly paperTotalUsdMicros?: bigint;
  readonly assets: AssetInfos;
  /** Absent when no wallet of the view holds a stake or unbonding coin. */
  readonly staking?: readonly StakingPositionView[];
  /** Absent when no wallet of the view has a bridge in transit. */
  readonly inTransit?: readonly InTransitView[];
}

/** Parses one wallet's balance of one asset. */
export const balanceViewSchema: z.ZodType<BalanceView> = z.object({
  wallet: protocolIdSchema("wallet"),
  amount: amountSchema,
  usdMicros: decimalStringSchema.exactOptional(),
  paper: z.boolean(),
});

/** Parses one wallet's stake with one validator. */
const stakingPositionViewSchema: z.ZodType<StakingPositionView> = z.object({
  wallet: protocolIdSchema("wallet"),
  venue: venueIdSchema,
  validator: accountRefSchema.exactOptional(),
  staked: amountSchema.exactOptional(),
  stakedValue: amountSchema.exactOptional(),
  unbonding: z.array(z.object({ amount: amountSchema, readyAt: epochMsSchema })),
  claimable: amountSchema,
  paper: z.boolean(),
});

/** Parses a bridge in transit. */
const inTransitViewSchema: z.ZodType<InTransitView> = z.object({
  intent: protocolIdSchema("intent"),
  wallet: protocolIdSchema("wallet"),
  amount: amountSchema,
  usdMicros: decimalStringSchema.exactOptional(),
  toChain: chainRefSchema,
  recipient: accountRefSchema,
  sentAt: epochMsSchema,
  late: z.boolean(),
});

/** Parses a portfolio view. */
export const portfolioViewSchema: z.ZodType<PortfolioView> = z.object({
  balances: z.array(balanceViewSchema),
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
  paperTotalUsdMicros: decimalStringSchema.exactOptional(),
  assets: assetInfosSchema,
  staking: z.array(stakingPositionViewSchema).exactOptional(),
  inTransit: z.array(inTransitViewSchema).exactOptional(),
});
