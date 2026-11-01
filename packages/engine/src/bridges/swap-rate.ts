import type { Amount, BridgeFee } from "@binference/chain";
import { type Bps, bpsPerWhole, bpsSchema } from "@binference/core";

/** What a quote's swap rate is worked out from. */
export interface SwapRateInput {
  /** The amount sent, in the token that leaves. */
  readonly amount: Amount;
  /** What the bridge keeps, each in the token that leaves. */
  readonly fees: readonly BridgeFee[];
  /** The least the fill pays, in the token that arrives. */
  readonly minOut: Amount;
  readonly decimals: { readonly leaves: number; readonly arrives: number };
}

// The input less the fees at the arriving token's decimals, rounded up, so a rate never reads
// lower than it is.
function netOf(input: SwapRateInput): bigint {
  const kept = input.fees.reduce((sum, fee) => sum + fee.amount.base, 0n);
  const net = input.amount.base - kept;
  const { leaves, arrives } = input.decimals;
  if (arrives >= leaves) {
    return net * 10n ** BigInt(arrives - leaves);
  }
  const unit = 10n ** BigInt(leaves - arrives);
  return net <= 0n ? net : (net + unit - 1n) / unit;
}

/**
 * The share of the input less the bridge's fees that a swap into another token keeps, in basis
 * points rounded up, a dollar counted as a dollar (decision 0323): what the input less the fees
 * would pay at one to one, less the quote's least output. A least output at or above that is 0; a
 * quote whose fees take the whole input keeps it all.
 */
export function swapRateOf(input: SwapRateInput): Bps {
  const net = netOf(input);
  if (net <= 0n) {
    return bpsSchema.parse(bpsPerWhole);
  }
  const gap = net - input.minOut.base;
  if (gap <= 0n) {
    return bpsSchema.parse(0);
  }
  return bpsSchema.parse(ceilBps(gap, net));
}

// The least whole basis point at or above `gap` of `net`, found by halving 0 to 10,000 in bigint,
// so no amount passes through a float.
function ceilBps(gap: bigint, net: bigint): number {
  const asked = gap * BigInt(bpsPerWhole);
  let low = 0;
  let high = bpsPerWhole;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (BigInt(middle) * net >= asked) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}
