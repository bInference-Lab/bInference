import { bpsPerWhole } from "@binference/core";
import type { FillSize } from "@binference/protocol";

/** What the wallet holds of a buy order's spending asset when a fill is quoted. */
export interface SpendingBalance {
  /** On chain for a live wallet, in the paper portfolio for a paper one. */
  readonly balanceBase: bigint;
  /** Whether the order spends the chain's coin, which pays the network fees. */
  readonly isChainCoin: boolean;
  /** The coin the wallet keeps for network fees (decision 0045), in base units. */
  readonly gasReserveBase: bigint;
}

/**
 * What a buy order may spend of its spending asset: the whole balance of a token, and of the
 * chain's coin what lies above the gas reserve, since trades never spend the reserve (decision
 * 0045). Never below 0.
 */
export function spendableBase(balance: SpendingBalance): bigint {
  const keptBase = balance.isChainCoin ? balance.gasReserveBase : 0n;
  return balance.balanceBase > keptBase ? balance.balanceBase - keptBase : 0n;
}

/**
 * What one fill of a buy order spends, in base units of its spending asset (decision 0190):
 * `{ base }` as it is, `{ percentBps }` that share of the spendable balance, rounded down. A size
 * in dollars is priced when the fill is quoted, so it has no base amount here: `undefined`.
 */
export function buyFillSpendBase(size: FillSize, balance: SpendingBalance): bigint | undefined {
  if ("usdMicros" in size) {
    return undefined;
  }
  if ("base" in size) {
    return size.base;
  }
  return (spendableBase(balance) * BigInt(size.percentBps)) / BigInt(bpsPerWhole);
}
