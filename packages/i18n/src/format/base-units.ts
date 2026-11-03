const decimalText = /^(\d+)(?:\.(\d+))?$/;

/**
 * An amount written as decimal text, such as `"0.002"` BNB, in base units for a coin of
 * `decimals` decimals; `undefined` for text that is no decimal or has more decimals than the coin.
 */
export function baseUnitsOf(text: string, decimals: number): bigint | undefined {
  const [, whole = "", fraction = ""] = decimalText.exec(text) ?? [];
  if (whole === "" || fraction.length > decimals) {
    return undefined;
  }
  const scale = 10n ** BigInt(decimals);
  return BigInt(whole) * scale + (fraction === "" ? 0n : BigInt(fraction.padEnd(decimals, "0")));
}
