import { BinferenceError } from "@binference/core";

/** A decimal number as text, which `Intl.NumberFormat` formats exactly, never through a float. */
export type DecimalText = `${number}`;

const decimalPattern = /^-?\d+(?:\.\d+)?$/;

function isDecimalText(text: string): text is DecimalText {
  return decimalPattern.test(text);
}

/**
 * Writes base units as an exact decimal without trailing zeros: `1500000000000000000n` with 18
 * decimals is `"1.5"`. Throws `i18n.bad_decimals` unless `decimals` is a whole number from 0.
 */
export function decimalText(amountBase: bigint, decimals: number): DecimalText {
  if (!Number.isSafeInteger(decimals) || decimals < 0) {
    throw new BinferenceError({
      code: "i18n.bad_decimals",
      message: `Decimals must be a whole number from 0, not ${String(decimals)}.`,
    });
  }
  const sign = amountBase < 0n ? "-" : "";
  const digits = (amountBase < 0n ? -amountBase : amountBase)
    .toString()
    .padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, "");
  const text = fraction === "" ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
  if (!isDecimalText(text)) {
    throw new BinferenceError({ code: "i18n.bad_decimals", message: `${text} is no decimal.` });
  }
  return text;
}
