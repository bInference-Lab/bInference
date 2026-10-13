import type { Ratio } from "@binference/core";

/** A Uniswap v2 pair's reserves, as the token and its quote. */
export interface PairReserves {
  readonly reserveToken: bigint;
  readonly reserveQuote: bigint;
}

/**
 * The swap that moves a pair to a price: the side, what goes in and what comes out, in base
 * units. `buy` puts quote in for the token; `sell` puts the token in for quote.
 */
export interface PairSwap {
  readonly side: "buy" | "sell";
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

// PancakeSwap's v2 pairs keep 25 of every 10,000 put in as their fee.
const feeKept = 9_975n;
const feeWhole = 10_000n;

/** What a v2 pair pays out for `amountIn` against its reserves, after its fee, rounded down. */
export function pairAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  const inAfterFee = amountIn * feeKept;
  return (inAfterFee * reserveOut) / (reserveIn * feeWhole + inAfterFee);
}

/** The square root of `value`, rounded down. */
export function sqrtFloor(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }
  let root = value;
  let next = (root + 1n) / 2n;
  while (next < root) {
    root = next;
    next = (root + value / root) / 2n;
  }
  return root;
}

// The pair's reserves after a swap of `amountIn` on `side`.
function afterSwap(reserves: PairReserves, side: PairSwap["side"], amountIn: bigint) {
  const { reserveToken, reserveQuote } = reserves;
  if (side === "buy") {
    const out = pairAmountOut(amountIn, reserveQuote, reserveToken);
    return { reserveToken: reserveToken - out, reserveQuote: reserveQuote + amountIn, out };
  }
  const out = pairAmountOut(amountIn, reserveToken, reserveQuote);
  return { reserveToken: reserveToken + amountIn, reserveQuote: reserveQuote - out, out };
}

// -1, 0 or 1 as the reserves' price, quote per token, is under, at or over the target.
function comparedTo(reserves: PairReserves, target: Ratio): number {
  const price = reserves.reserveQuote * target.denominator;
  const wanted = target.numerator * reserves.reserveToken;
  if (price === wanted) {
    return 0;
  }
  return price < wanted ? -1 : 1;
}

// The least amount in whose swap reaches the target, above `low`, which does not: `high` doubles
// until it does, then a bisection finds it, exact in base units.
function leastReaching(
  reserves: PairReserves,
  move: { readonly side: PairSwap["side"]; readonly target: Ratio },
  bounds: { readonly low: bigint; readonly high: bigint },
): bigint {
  let { low, high } = bounds;
  const reaches = (amountIn: bigint): boolean => {
    const order = comparedTo(afterSwap(reserves, move.side, amountIn), move.target);
    return move.side === "buy" ? order >= 0 : order <= 0;
  };
  while (!reaches(high)) {
    low = high;
    high *= 2n;
  }
  while (high - low > 1n) {
    const middle = (low + high) / 2n;
    if (reaches(middle)) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

// The amount in that would reach the target with no fee, from the constant product: the side
// put in ends at √(k·P) of quote, or √(k/P) of the token.
function feelessAmountIn(reserves: PairReserves, side: PairSwap["side"], target: Ratio): bigint {
  const product = reserves.reserveToken * reserves.reserveQuote;
  return side === "buy"
    ? sqrtFloor((product * target.numerator) / target.denominator) - reserves.reserveQuote
    : sqrtFloor((product * target.denominator) / target.numerator) - reserves.reserveToken;
}

/**
 * The swap that moves a v2 pair's price, quote per token in base units, to `target` or the least
 * step past it: the least amount in, to the base unit, whose swap reaches the target after the pair's fee.
 * `undefined` when the pair already stands at the target.
 */
export function swapToPrice(reserves: PairReserves, target: Ratio): PairSwap | undefined {
  const order = comparedTo(reserves, target);
  if (order === 0) {
    return undefined;
  }
  const side = order < 0 ? "buy" : "sell";
  const feeless = feelessAmountIn(reserves, side, target);
  // The fee asks for a little more than the feeless amount, so the search starts at twice it.
  const amountIn = leastReaching(
    reserves,
    { side, target },
    { low: 0n, high: 2n * (feeless > 0n ? feeless : 0n) + 2n },
  );
  return { side, amountIn, amountOut: afterSwap(reserves, side, amountIn).out };
}
