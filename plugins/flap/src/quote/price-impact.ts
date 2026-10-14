import { type Bps, bpsSchema } from "@binference/plugin-sdk";
import { curveLossBps } from "@binference/plugin-sdk/evm";

const whole = 10_000n;
const wad = 10n ** 18n;
const impactUnknown: Bps = bpsSchema.parse(Number(whole));

/** A curve trade as its quote values it, all in base units, with the curve's price now. */
export interface CurveTrade {
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** Base units of the quote token for one whole token (10^18 base units), before the trade. */
  readonly price: bigint;
  /** The tax the Portal takes on this side, in basis points, which the quote names apart. */
  readonly taxBps: bigint;
}

/**
 * The share of the input's value a curve trade loses at the curve's price now, rounded up: the
 * curve's fee and the price the trade moves, leaving out the tax the quote names apart, which the
 * risk check judges against the agent's maximum tax. A buy's tax is that share of its input; a
 * sale's is that share of its gross proceeds, at least `out × tax / (1 − tax)`, so the impact is
 * never understated. A curve with no price, or a trade of nothing, cannot be told: the whole input.
 */
export function curveImpactBps(trade: CurveTrade): Bps {
  const { side, amountIn, amountOut, price, taxBps } = trade;
  if (price === 0n || amountIn === 0n || taxBps >= whole) {
    return impactUnknown;
  }
  if (side === "buy") {
    const valueOut = (amountOut * price) / wad;
    return curveLossBps(amountIn - valueOut - (amountIn * taxBps) / whole, amountIn);
  }
  const valueIn = (amountIn * price + wad - 1n) / wad;
  const taxFloor = (amountOut * taxBps) / (whole - taxBps);
  return valueIn === 0n ? impactUnknown : curveLossBps(valueIn - amountOut - taxFloor, valueIn);
}
