import { BinferenceError } from "../errors/binference-error.js";
import { bpsPerWhole, type Bps } from "./basis-points.js";

/** Which way a division rounds when it is not exact. */
export type Rounding = "down" | "up";

/** A fraction with a positive denominator. */
export interface Ratio {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** An amount cut in two: `part` rounds down, so `part + rest` is always the whole. */
export interface AmountSplit {
  readonly part: bigint;
  readonly rest: bigint;
}

function assertNonNegative(name: string, value: bigint): void {
  if (value < 0n) {
    throw new BinferenceError({
      code: "core.negative_amount",
      message: `${name} must not be negative.`,
    });
  }
}

/**
 * Multiplies a base-unit amount by a ratio and rounds the result the stated way. Both the amount
 * and the ratio must be non-negative, and the denominator above zero.
 */
export function mulDiv(amountBase: bigint, ratio: Ratio, rounding: Rounding): bigint {
  assertNonNegative("The amount", amountBase);
  assertNonNegative("The numerator", ratio.numerator);
  if (ratio.denominator <= 0n) {
    throw new BinferenceError({
      code: "core.zero_denominator",
      message: "The denominator must be above zero.",
    });
  }
  const product = amountBase * ratio.numerator;
  const quotient = product / ratio.denominator;
  const isExact = quotient * ratio.denominator === product;
  return rounding === "up" && !isExact ? quotient + 1n : quotient;
}

/** Takes a share in basis points of a base-unit amount, rounded the stated way. */
export function applyBps(amountBase: bigint, bps: Bps, rounding: Rounding): bigint {
  return mulDiv(amountBase, { numerator: BigInt(bps), denominator: BigInt(bpsPerWhole) }, rounding);
}

/** Splits off a share in basis points, rounded down; the rest keeps every remaining unit. */
export function splitByBps(amountBase: bigint, bps: Bps): AmountSplit {
  const part = applyBps(amountBase, bps, "down");
  return { part, rest: amountBase - part };
}
