import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coinOfShares, type CreditPool, unstakeShares } from "./credit-shares.js";

const bnb = 10n ** 18n;

// A credit contract's pool as StakeCredit keeps it: shares and coin above zero, and a wallet's
// balance within the shares. Rewards raise the price of a share and a slash lowers it, so the coin
// may be more or less than the shares.
const pools = fc
  .record({
    supply: fc.bigInt({ min: 1n, max: 10n ** 9n * bnb }),
    pooled: fc.bigInt({ min: 1n, max: 2n * 10n ** 9n * bnb }),
    share: fc.bigInt({ min: 1n, max: 10_000n }),
  })
  .map(({ supply, pooled, share }): CreditPool => {
    const balance = (supply * share) / 10_000n;
    return { supply, pooled, balance: balance > 0n ? balance : 1n };
  });

const worthOf = (pool: CreditPool): bigint => coinOfShares(pool.balance, pool);

// An amount the stake covers, from one wei to its whole worth.
const covered = pools
  .filter((pool) => worthOf(pool) > 0n)
  .chain((pool) =>
    fc.record({ pool: fc.constant(pool), amount: fc.bigInt({ min: 1n, max: worthOf(pool) }) }),
  );

// What an unstake of the amount must hold, each as a named check.
function holdsFor(pool: CreditPool, amount: bigint): Readonly<Record<string, boolean>> {
  const burned = unstakeShares(amount, pool);
  const { shares, moved } = burned === "exceeds_staked" ? { shares: -1n, moved: -1n } : burned;
  const isAll = shares === pool.balance;
  return {
    planned: burned !== "exceeds_staked",
    pricedAsStakeCredit: moved === coinOfShares(shares, pool),
    atLeastAsked: moved >= amount,
    withinHeld: shares <= pool.balance,
    fewest: isAll || coinOfShares(shares - 1n, pool) < amount,
    noDust: amount !== worthOf(pool) || isAll,
  };
}

describe("the shares an unstake burns", () => {
  it("are the fewest worth at least the amount, never more than held, priced as StakeCredit does", () => {
    fc.assert(
      fc.property(covered, ({ pool, amount }) => {
        const checks = holdsFor(pool, amount);
        expect(checks).toStrictEqual(
          Object.fromEntries(Object.keys(checks).map((key) => [key, true])),
        );
      }),
      { numRuns: 2_000 },
    );
  });

  it("refuse an amount above the stake's worth", () => {
    fc.assert(
      fc.property(pools, fc.bigInt({ min: 1n, max: bnb }), (pool, above) => {
        expect(unstakeShares(worthOf(pool) + above, pool)).toBe("exceeds_staked");
      }),
    );
  });

  it("burn every share for an amount of the stake's whole worth, leaving no dust", () => {
    fc.assert(
      fc.property(pools, (pool) => {
        expect(unstakeShares(worthOf(pool), pool)).toStrictEqual({
          shares: pool.balance,
          moved: worthOf(pool),
        });
      }),
      { numRuns: 2_000 },
    );
  });

  it("burn every share for the whole stake, whatever it grew to since it was read", () => {
    fc.assert(
      fc.property(pools, (pool) => {
        expect(unstakeShares("whole", pool)).toStrictEqual({
          shares: pool.balance,
          moved: worthOf(pool),
        });
      }),
    );
  });
});
