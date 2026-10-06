import type { ChainRef } from "@binference/chain";
import { bsc } from "@binference/chains";
import { type Bps, isBps } from "@binference/core";
import { z } from "zod";
import { chainSchema, decimalSchema, usdSchema } from "./value-formats.schema.js";

/** Slippage limits for registry tokens and for every other token. */
export interface SlippageConfig {
  readonly registry: Bps;
  readonly other: Bps;
}

/** A new agent's trade limits. Dollar values are `bigint` micro-dollars. */
export interface LimitsConfig {
  readonly perTradeUsd: bigint;
  readonly rollingDayUsd: bigint;
  readonly slippageBps: SlippageConfig;
  readonly priceImpactBps: Bps;
  readonly taxBps: Bps;
  readonly liquidityFloorUsd: bigint;
  readonly minHealthFactor: number;
  /** The native coin kept for gas on each chain, as decimal text such as `"0.002"`. */
  readonly gasReserve: Readonly<Record<ChainRef, string>>;
  /** The venues a new agent may use; left out, every installed core venue. */
  readonly venues?: readonly string[];
  readonly allowTokens: readonly string[];
  readonly denyTokens: readonly string[];
}

/** How long cards live and when a quote is taken again. */
export interface CardsConfig {
  readonly tradeExpirySec: number;
  readonly otherExpirySec: number;
  readonly requoteAfterSec: number;
  readonly requoteToleranceBps: Bps;
}

/** What `binference` copies into each new agent's rows once, at creation. */
export interface AgentDefaultsConfig {
  readonly limits: LimitsConfig;
  readonly sendLevel: number;
  readonly approvalMode: "manual" | "auto";
  /** The Privy policy's per-transaction cap in BNB, as decimal text. */
  readonly ceiling: { readonly perTxBnb: string };
  readonly cards: CardsConfig;
  readonly orders: { readonly expiryDays: number };
  readonly copy: { readonly perBuyUsd: bigint; readonly perLeaderDayUsd: bigint };
  /** Paper-mode starting balances by token symbol, as decimal text. */
  readonly paper: { readonly balances: Readonly<Record<string, string>> };
  readonly modelBudgetUsdPerDay: bigint;
}

const bps = (fallback: number, description: string) =>
  z.int().min(0).max(10_000).refine(isBps).prefault(fallback).describe(description);

const usd = (fallback: number, description: string) =>
  usdSchema.prefault(fallback).describe(description);

const positiveInt = (fallback: number, description: string) =>
  z.int().positive().prefault(fallback).describe(description);

const limitsSchema = z
  .strictObject({
    perTradeUsd: usd(100, "The most one trade may move, in US dollars."),
    rollingDayUsd: usd(500, "The most trades and sends may move in 24 hours, in US dollars."),
    slippageBps: z
      .strictObject({
        registry: bps(100, "Slippage allowed on registry tokens, in basis points."),
        other: bps(500, "Slippage allowed on every other token, in basis points."),
      })
      .prefault({})
      .describe("Slippage limits."),
    priceImpactBps: bps(300, "The largest price impact allowed, in basis points."),
    taxBps: bps(1000, "The largest token tax allowed, in basis points."),
    liquidityFloorUsd: usd(10_000, "The least pool liquidity a trade needs, in US dollars."),
    minHealthFactor: z
      .number()
      .min(1)
      .prefault(1.5)
      .describe("The lowest lending health factor a move may leave."),
    gasReserve: z
      .record(chainSchema, decimalSchema)
      .prefault({ [bsc.id]: "0.002" })
      .meta({ description: "The native coin kept for gas, per chain.", keyName: "chain" }),
    venues: z
      .array(z.string().min(1))
      .exactOptional()
      .meta({ description: "The venues allowed.", defaultText: "every installed core venue" }),
    allowTokens: z
      .array(z.string().min(1))
      .prefault([])
      .describe("Tokens allowed; empty allows every token that passes the risk check."),
    denyTokens: z.array(z.string().min(1)).prefault([]).describe("Tokens refused."),
  })
  .prefault({})
  .describe("Trade limits.");

const cardsSchema = z
  .strictObject({
    tradeExpirySec: positiveInt(60, "A trade card expires after this many seconds."),
    otherExpirySec: positiveInt(600, "Other cards expire after this many seconds."),
    requoteAfterSec: positiveInt(10, "A quote older than this many seconds is taken again."),
    requoteToleranceBps: bps(50, "A new quote this much worse asks again, in basis points."),
  })
  .prefault({})
  .describe("Cards.");

/** Parses `defaults`. */
export const agentDefaultsSchema: z.ZodType<AgentDefaultsConfig> = z
  .strictObject({
    limits: limitsSchema,
    sendLevel: z.int().min(0).max(3).prefault(0).describe("The send level, 0 to 3."),
    approvalMode: z
      .enum(["manual", "auto"])
      .prefault("manual")
      .describe("Whether trades within the caps wait for a tap."),
    ceiling: z
      .strictObject({
        perTxBnb: decimalSchema
          .prefault("1")
          .describe("The Privy policy's per-transaction cap, in BNB."),
      })
      .prefault({})
      .describe("The wallet policy's ceiling."),
    cards: cardsSchema,
    orders: z
      .strictObject({ expiryDays: positiveInt(30, "An auto order expires after this many days.") })
      .prefault({})
      .describe("Auto orders."),
    copy: z
      .strictObject({
        perBuyUsd: usd(20, "The most one copied buy may spend, in US dollars."),
        perLeaderDayUsd: usd(200, "The most copies of one leader may spend a day, in US dollars."),
      })
      .prefault({})
      .describe("Copy trading."),
    paper: z
      .strictObject({
        balances: z
          .record(z.string().min(1), decimalSchema)
          .prefault({ BNB: "1", USDT: "500" })
          .meta({ description: "Paper-mode starting balances.", keyName: "symbol" }),
      })
      .prefault({})
      .describe("Paper mode."),
    modelBudgetUsdPerDay: usd(3, "The most model calls may cost a day, in US dollars."),
  })
  .prefault({})
  .describe("What each new agent starts with; copied into its rows once, at creation.");
