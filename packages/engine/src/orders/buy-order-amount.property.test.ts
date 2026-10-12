import { type Bps, bpsPerWhole } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buyFillSpendBase, type SpendingBalance, spendableBase } from "./buy-order-amount.js";

const base = fc.bigInt({ min: 0n, max: 2n ** 96n });

const balances: fc.Arbitrary<SpendingBalance> = fc.record({
  balanceBase: base,
  isChainCoin: fc.boolean(),
  gasReserveBase: base,
});

const shares: fc.Arbitrary<{ readonly percentBps: Bps }> = fc
  .integer({ min: 1, max: bpsPerWhole })
  .map((bps) => ({ percentBps: bps as Bps }));

// What the wallet may spend, worked out apart from the module: never the coin's reserve.
function oracleSpendable(balance: SpendingBalance): bigint {
  const left = balance.isChainCoin
    ? balance.balanceBase - balance.gasReserveBase
    : balance.balanceBase;
  return left < 0n ? 0n : left;
}

// What a share-sized fill spends; a share always comes to a base amount.
function spentByShare(size: { readonly percentBps: Bps }, balance: SpendingBalance): bigint {
  const spent = buyFillSpendBase(size, balance);
  if (spent === undefined) {
    throw new Error("Expected a base amount for a share.");
  }
  return spent;
}

const least = (a: bigint, b: bigint): bigint => (a < b ? a : b);

describe("what a buy order's fill spends, for every balance", () => {
  it("never spends more than the spendable balance when sized by share", () => {
    fc.assert(
      fc.property(shares, balances, (size, balance) => {
        const spent = spentByShare(size, balance);
        expect(spent).toBeGreaterThanOrEqual(0n);
        expect(spent).toBeLessThanOrEqual(oracleSpendable(balance));
        expect(spent).toBeLessThanOrEqual(balance.balanceBase);
      }),
      { numRuns: 2_000 },
    );
  });

  it("never touches the gas reserve when it spends the chain's coin", () => {
    fc.assert(
      fc.property(shares, base, base, (size, balanceBase, gasReserveBase) => {
        const balance = { balanceBase, isChainCoin: true, gasReserveBase };
        const kept = balanceBase - spentByShare(size, balance);
        expect(kept).toBeGreaterThanOrEqual(least(balanceBase, gasReserveBase));
      }),
      { numRuns: 1_000 },
    );
  });

  it("spends the share rounded down, and all that is spendable at 100%", () => {
    fc.assert(
      fc.property(shares, balances, (size, balance) => {
        const spendable = oracleSpendable(balance);
        expect(spendableBase(balance)).toBe(spendable);
        expect(buyFillSpendBase(size, balance)).toBe(
          (spendable * BigInt(size.percentBps)) / BigInt(bpsPerWhole),
        );
        expect(buyFillSpendBase({ percentBps: bpsPerWhole as Bps }, balance)).toBe(spendable);
      }),
    );
  });

  it("spends a size in base units as it is, and leaves a dollar size to the quote", () => {
    fc.assert(
      fc.property(base, balances, (amount, balance) => {
        expect(buyFillSpendBase({ base: amount }, balance)).toBe(amount);
        expect(buyFillSpendBase({ usdMicros: amount }, balance)).toBeUndefined();
      }),
    );
  });
});
