import { decimalStringSchema } from "@binference/core";
import { z } from "zod";

/**
 * What a risk source can say about a token. A source maps its own answer into these codes and
 * reports only those it found; the engine decides which ones block a trade.
 */
export const riskFlagCodes = [
  "honeypot",
  "cannot_sell",
  "cannot_sell_all",
  "cannot_buy",
  "hidden_owner",
  "owner_changes_balances",
  "owner_reclaims",
  "blacklist",
  "whitelist",
  "transfer_pausable",
  "transfer_blocked",
  "tax_changeable",
  "tax_per_holder",
  "trading_cooldown",
  "holding_cap",
  "sell_limit",
  "sell_failures",
  "siphoned",
  "mintable",
  "proxy",
  "closed_source",
  "self_destruct",
  "fake_token",
  "airdrop_scam",
  "high_risk",
] as const;

/** One finding of a risk source, such as `honeypot` or `mintable`. */
export type RiskFlagCode = (typeof riskFlagCodes)[number];

/** What one risk source reports about one token. */
export interface TokenRiskReport {
  /** The findings, each once, in the order of {@link riskFlagCodes}. */
  readonly flags: readonly RiskFlagCode[];
  /**
   * The USD value of the token's liquidity the source knows of, in micro-dollars, rounded down.
   * A source counts only the pools it knows, so the figure is a floor of the token's liquidity.
   * Absent when the source knows of no pool.
   */
  readonly liquidityUsdMicros?: bigint;
}

/** A {@link TokenRiskReport} as JSON carries it: liquidity as a decimal string. */
export interface TokenRiskReportWire {
  readonly flags: readonly RiskFlagCode[];
  readonly liquidityUsdMicros?: string;
}

/** Decodes a risk report from JSON, such as a cached one, and encodes it back with `z.encode`. */
export const tokenRiskReportSchema: z.ZodType<TokenRiskReport, TokenRiskReportWire> =
  z.strictObject({
    flags: z.array(z.enum(riskFlagCodes)),
    liquidityUsdMicros: decimalStringSchema.exactOptional(),
  });

/** The flags in the order of {@link riskFlagCodes}, each once, as a report holds them. */
export function orderedFlags(flags: Iterable<RiskFlagCode>): readonly RiskFlagCode[] {
  const found = new Set(flags);
  return riskFlagCodes.filter((code) => found.has(code));
}
