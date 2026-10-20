// A PancakeSwap V3 pool's price at a tick is 1.0001^tick, in base units of the pair per base unit
// of the token. It is worked out here in 128-bit fixed point, rounded down at each step, which
// keeps the start's tick the same on every machine; it need not match the pool's own TickMath to
// the last bit, as the factory takes any tick on the pool's spacing.
const one = 1n << 128n;
const tickBase = (10_001n << 128n) / 10_000n;
// The pool's own bound on a tick, and what the factory takes inside it: strictly within the
// largest tick on the spacing.
const maxTick = 887_272;

// 1.0001^exponent for an exponent of 0 or more, in 128-bit fixed point.
function powerOf(exponent: bigint): bigint {
  let result = one;
  let square = tickBase;
  let left = exponent;
  while (left > 0n) {
    if ((left & 1n) === 1n) {
      result = (result * square) >> 128n;
    }
    square = (square * square) >> 128n;
    left >>= 1n;
  }
  return result;
}

// The pool's price at a tick, in 128-bit fixed point.
function ratioAt(tick: bigint): bigint {
  return tick >= 0n ? powerOf(tick) : (one * one) / powerOf(-tick);
}

/** A pool's starting price: base units of the pair a whole supply of the token is worth. */
export interface StartPrice {
  /** The market cap the token starts at, in base units of the pair. */
  readonly marketCapBase: bigint;
  /** The token's whole supply, in its base units. */
  readonly supplyBase: bigint;
  /** The pool's tick spacing, which its fee tier sets. */
  readonly spacing: number;
}

/**
 * The tick a launch starts its pool at (decision 0283): the highest tick on the spacing whose
 * price is at most the market cap over the supply, so the token starts at that market cap or one
 * price step below it, within the bounds the factory takes. A price no such tick reaches is `undefined`.
 */
export function startTickOf(start: StartPrice): number | undefined {
  const spacing = BigInt(start.spacing);
  const most = BigInt(Math.floor(maxTick / start.spacing)) - 1n;
  const fits = (step: bigint): boolean =>
    ratioAt(step * spacing) * start.supplyBase <= start.marketCapBase << 128n;
  // A price below the lowest tick, or past the step above the highest, no tick reaches.
  if (start.marketCapBase <= 0n || !fits(-most) || fits(most + 1n)) {
    return undefined;
  }
  let low = -most;
  let high = most;
  while (low < high) {
    const middle = low + (high - low + 1n) / 2n;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle - 1n;
    }
  }
  return Number(low * spacing);
}
