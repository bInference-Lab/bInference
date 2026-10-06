import { describe, expect, it } from "vitest";
import { acquire, dispose, emptyCostBasis } from "./average-cost.js";

const holding = { quantityBase: 3n, costUsdMicros: 10n, realizedUsdMicros: 0n };

describe("acquire", () => {
  it("adds the units and their full cost to what the position holds", () => {
    expect(acquire(holding, 2n, 7n)).toStrictEqual({
      quantityBase: 5n,
      costUsdMicros: 17n,
      realizedUsdMicros: 0n,
    });
  });

  it("realizes the cost of a buy that delivered no units as a loss", () => {
    expect(acquire(holding, 0n, 7n)).toStrictEqual({ ...holding, realizedUsdMicros: -7n });
  });

  it("refuses a negative quantity or cost", () => {
    expect(() => acquire(holding, -1n, 7n)).toThrow(
      expect.objectContaining({ code: "positions.negative_amount" }),
    );
    expect(() => acquire(holding, 1n, -7n)).toThrow(
      expect.objectContaining({ code: "positions.negative_amount" }),
    );
  });
});

describe("dispose", () => {
  it("takes the average cost of the units sold, rounded up, and realizes the rest", () => {
    // 10 micro-dollars over 3 units: 1 unit costs 3.33, rounded up to 4.
    expect(dispose(holding, 1n, 5n)).toStrictEqual({
      quantityBase: 2n,
      costUsdMicros: 6n,
      realizedUsdMicros: 1n,
    });
  });

  it("takes an exact share of the cost when it divides", () => {
    const even = { quantityBase: 4n, costUsdMicros: 10n, realizedUsdMicros: 2n };
    expect(dispose(even, 2n, 3n)).toStrictEqual({
      quantityBase: 2n,
      costUsdMicros: 5n,
      realizedUsdMicros: 0n,
    });
  });

  it("takes all the cost left with the last unit, and leaves nothing held", () => {
    expect(dispose(holding, 3n, 4n)).toStrictEqual({
      quantityBase: 0n,
      costUsdMicros: 0n,
      realizedUsdMicros: -6n,
    });
  });

  it("sells units it never saw bought at their own proceeds, with no gain or loss", () => {
    // 3 held of 5 sold: the 3 bring 3/5 of 20, which is 12; the other 2 bring no gain.
    expect(dispose(holding, 5n, 20n)).toStrictEqual({
      quantityBase: 0n,
      costUsdMicros: 0n,
      realizedUsdMicros: 2n,
    });
    // 3 held of 4 sold: 3/4 of 7 is 5.25, rounded down to 5, less the cost of 10.
    expect(dispose(holding, 4n, 7n)).toStrictEqual({
      quantityBase: 0n,
      costUsdMicros: 0n,
      realizedUsdMicros: -5n,
    });
    expect(dispose(emptyCostBasis, 5n, 20n)).toStrictEqual(emptyCostBasis);
  });

  it("changes nothing when it sells no units", () => {
    expect(dispose(holding, 0n, 0n)).toBe(holding);
  });

  it("refuses a negative quantity or proceeds", () => {
    expect(() => dispose(holding, -1n, 1n)).toThrow(
      expect.objectContaining({ code: "positions.negative_amount" }),
    );
    expect(() => dispose(holding, 1n, -1n)).toThrow(
      expect.objectContaining({ code: "positions.negative_amount" }),
    );
  });
});
