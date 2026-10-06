import type { Bps } from "@binference/core";
import { decimalText } from "./decimal-text.js";

// Both languages write numbers and money the English way ($1.20, 0.005 BNB), so every number
// format is en-US.
const numberTag = "en-US";

// Six significant digits, but never fewer than the whole part has: 1,234,567 stays whole. The
// cut is toward zero, so a balance or a minimum received never shows more than it is.
const tokenFormat = new Intl.NumberFormat(numberTag, {
  maximumSignificantDigits: 6,
  maximumFractionDigits: 0,
  roundingPriority: "morePrecision",
  roundingMode: "trunc",
});

const usdFormat = new Intl.NumberFormat(numberTag, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const percentFormat = new Intl.NumberFormat(numberTag, {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdDecimals = 6;
const bpsDecimals = 4;
const microsPerCent = 10_000n;

/**
 * Formats base units of a token with 6 significant digits and the whole part kept: `0.5`,
 * `312.4`, `1,234,567`. The number is cut toward zero, never rounded up.
 */
export function formatTokenAmount(amountBase: bigint, decimals: number): string {
  return tokenFormat.format(decimalText(amountBase, decimals));
}

/** Formats micro-dollars with 2 decimals, `$612.40`; a value under a cent is `<$0.01`. */
export function formatUsd(usdMicros: bigint): string {
  const isUnderCent = usdMicros !== 0n && usdMicros > -microsPerCent && usdMicros < microsPerCent;
  if (isUnderCent) {
    return usdMicros < 0n ? "-<$0.01" : "<$0.01";
  }
  return usdFormat.format(decimalText(usdMicros, usdDecimals));
}

/** Formats a rate in basis points as a percentage with 2 decimals: 50 is `0.50%`. */
export function formatPercent(rate: Bps): string {
  return percentFormat.format(decimalText(BigInt(rate), bpsDecimals));
}
