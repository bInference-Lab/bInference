import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coinFor, leastStake, leastUnits, unitsFor } from "./pool-math.js";

const totals = fc.record({
  supply: fc.bigInt({ min: 1n, max: 10n ** 30n }),
  pooled: fc.bigInt({ min: 1n, max: 10n ** 30n }),
});
const amount = fc.bigInt({ min: 0n, max: 10n ** 30n });

describe("the pool math of Lista's stake manager", () => {
  it("mints and pays as the stake manager rounds, down, never more than the pool's rate gives", () => {
    fc.assert(
      fc.property(totals, amount, (pool, base) => {
        const minted = unitsFor(base, pool);
        const paid = coinFor(base, pool);
        expect(minted * pool.pooled <= base * pool.supply).toBe(true);
        expect((minted + 1n) * pool.pooled > base * pool.supply).toBe(true);
        expect(paid * pool.supply <= base * pool.pooled).toBe(true);
        expect((paid + 1n) * pool.supply > base * pool.pooled).toBe(true);
      }),
    );
  });

  it("names the least stake that mints a unit, while one coin less mints none", () => {
    fc.assert(
      fc.property(totals, (pool) => {
        const least = leastStake(pool);
        expect(unitsFor(least, pool)).toBeGreaterThanOrEqual(1n);
        expect(unitsFor(least - 1n, pool)).toBe(0n);
      }),
    );
  });

  it("promises some units, never more than minted, and no fewer than 10 basis points under", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: 10n ** 30n }), (minted) => {
        const least = leastUnits(minted);
        expect(least).toBeGreaterThan(0n);
        expect(least).toBeLessThanOrEqual(minted);
        expect(least * 10_000n >= minted * 9_990n - 10_000n).toBe(true);
      }),
    );
  });

  it("counts an empty supply or pool as one, as the stake manager does", () => {
    expect(unitsFor(5n, { supply: 0n, pooled: 0n })).toBe(5n);
    expect(coinFor(5n, { supply: 0n, pooled: 10n })).toBe(50n);
  });
});
