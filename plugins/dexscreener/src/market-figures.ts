import type { Ratio } from "@binference/plugin-sdk";
import { isJsonNumber } from "./api/json-text.schema.js";

/** A decimal number exactly: `digits × 10^-scale`, with a scale of zero or more. */
interface ExactDecimal {
  readonly digits: bigint;
  readonly scale: number;
}

// An exponent past this is no figure a market source means, and would make a huge number.
const maxExponent = 60;
const microsPerUnit = 1_000_000n;
const bpsPerPercent = 100n;

// Reads a JSON number's text exactly, its exponent folded into digits or scale.
function exactOf(text: string): ExactDecimal | undefined {
  if (!isJsonNumber(text)) {
    return undefined;
  }
  const [mantissa = "", exponentText = "0"] = text.toLowerCase().split("e");
  const exponent = Number(exponentText);
  if (Math.abs(exponent) > maxExponent) {
    return undefined;
  }
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = BigInt(`${whole}${fraction}`);
  const scale = fraction.length - exponent;
  return scale >= 0 ? { digits, scale } : { digits: digits * 10n ** BigInt(-scale), scale: 0 };
}

// The value times `unit`, toward zero.
function scaled(exact: ExactDecimal, unit: bigint): bigint {
  return (exact.digits * unit) / 10n ** BigInt(exact.scale);
}

/** A price as an exact ratio, such as `753.55` as 75355/100. Not a number, or below zero: none. */
export function ratioOf(text: string | undefined): Ratio | undefined {
  const exact = text === undefined ? undefined : exactOf(text);
  return exact === undefined || exact.digits < 0n
    ? undefined
    : { numerator: exact.digits, denominator: 10n ** BigInt(exact.scale) };
}

/** USD as micro-dollars, rounded down. Not a number, or below zero: none. */
export function usdMicrosOf(text: string | undefined): bigint | undefined {
  const exact = text === undefined ? undefined : exactOf(text);
  return exact === undefined || exact.digits < 0n ? undefined : scaled(exact, microsPerUnit);
}

/** A change in percent as signed basis points, toward zero: `-12.345` is -1234. */
export function changeBpsOf(percent: string | undefined): number | undefined {
  const exact = percent === undefined ? undefined : exactOf(percent);
  return exact === undefined ? undefined : Number(scaled(exact, bpsPerPercent));
}

/** A whole count or epoch time. A fraction, a negative or an unsafe integer: none. */
export function wholeOf(text: string | undefined): number | undefined {
  const exact = text === undefined ? undefined : exactOf(text);
  const unit = 10n ** BigInt(exact?.scale ?? 0);
  if (exact === undefined || exact.digits < 0n || exact.digits % unit !== 0n) {
    return undefined;
  }
  const value = Number(exact.digits / unit);
  return Number.isSafeInteger(value) ? value : undefined;
}
