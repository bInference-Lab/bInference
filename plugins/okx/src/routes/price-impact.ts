import { type Bps, bpsSchema } from "@binference/plugin-sdk";

const percentPattern = /^(-?)(\d{1,30})(?:\.(\d{1,30}))?$/;
const whole = 10_000n;
const impactUnknown: Bps = bpsSchema.parse(Number(whole));

/**
 * The share of the input's value a route loses, from OKX's price impact in percent, where a loss
 * is negative: `"-0.12"` is 12 basis points, rounded up so the loss is never understated, and a
 * gain is none. When OKX gives no impact or text that is no number, the impact cannot be told and
 * counts as the whole input.
 */
export function priceImpactOf(percent: string | undefined): Bps {
  const match = percent === undefined ? null : percentPattern.exec(percent);
  if (match === null) {
    return impactUnknown;
  }
  const [, sign = "", units = "", fraction = ""] = match;
  if (sign === "") {
    return bpsSchema.parse(0);
  }
  // Percent to basis points moves the point two places: 1.234 % is 123.4 bp, rounded up to 124.
  const scaled = BigInt(`${units}${fraction.padEnd(2, "0")}`);
  const scale = 10n ** BigInt(Math.max(fraction.length - 2, 0));
  const bps = (scaled + scale - 1n) / scale;
  return bpsSchema.parse(Number(bps > whole ? whole : bps));
}
