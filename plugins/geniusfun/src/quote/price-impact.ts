import { type Bps, bpsSchema } from "@binference/plugin-sdk";
import { curveLossBps } from "@binference/plugin-sdk/evm";
import type { CurveReserves } from "../contracts/genius-calls.js";

const impactUnknown: Bps = bpsSchema.parse(10_000);

/** A curve trade as its quote values it, in base units, with the curve's reserves before it. */
export interface CurveTrade {
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  /** What the trade pays in taxes, which the quote names apart, in base units of the quote side. */
  readonly taxPaid: bigint;
  readonly reserves: CurveReserves;
}

/**
 * The share of the input's value a curve trade loses at the curve's price before it, rounded up:
 * the curve's fee and the price the trade moves, leaving out the taxes the quote names apart,
 * which the risk step judges against the agent's maximum tax. The curve's price is its quote
 * reserve over its token reserve. A curve with an empty reserve, or a trade of nothing, cannot be
 * told: the whole input.
 */
export function curveImpactBps(trade: CurveTrade): Bps {
  const { quoteReserve, tokenReserve } = trade.reserves;
  if (quoteReserve === 0n || tokenReserve === 0n || trade.amountIn === 0n) {
    return impactUnknown;
  }
  if (trade.side === "buy") {
    const valueOut = (trade.amountOut * quoteReserve) / tokenReserve;
    return curveLossBps(trade.amountIn - valueOut - trade.taxPaid, trade.amountIn);
  }
  const valueIn = (trade.amountIn * quoteReserve + tokenReserve - 1n) / tokenReserve;
  return curveLossBps(valueIn - trade.amountOut - trade.taxPaid, valueIn);
}
