import { type Bps, bpsSchema } from "@binference/plugin-sdk";

const usdPattern = /^(\d{1,30})(?:\.(\d{1,30}))?$/;
const usdScale = 18;
const whole = 10_000n;
const impactUnknown: Bps = bpsSchema.parse(Number(whole));

// KyberSwap's USD estimate as an integer of 10^-18 dollars; digits past the 18th are dropped.
function scaledUsd(text: string): bigint | undefined {
  const match = usdPattern.exec(text);
  if (match === null) {
    return undefined;
  }
  const [, units = "", fraction = ""] = match;
  return BigInt(`${units}${fraction.slice(0, usdScale).padEnd(usdScale, "0")}`);
}

/**
 * The share of the input's USD value the route loses, from KyberSwap's own USD estimates, rounded
 * up so the loss is never understated. When KyberSwap prices either side at zero or not at all,
 * the impact cannot be told and counts as the whole input.
 */
export function priceImpactOf(amountInUsd: string, amountOutUsd: string): Bps {
  const valueIn = scaledUsd(amountInUsd);
  const valueOut = scaledUsd(amountOutUsd);
  if (valueIn === undefined || valueOut === undefined || valueIn === 0n || valueOut === 0n) {
    return impactUnknown;
  }
  const lost = valueOut >= valueIn ? 0n : (valueIn - valueOut) * whole;
  return bpsSchema.parse(Number((lost + valueIn - 1n) / valueIn));
}
