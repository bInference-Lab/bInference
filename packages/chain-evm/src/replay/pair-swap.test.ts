import { describe, expect, it } from "vitest";
import { type PairSwap, pairAmountOut, swapToPrice } from "./pair-swap.js";

const whole = 10n ** 18n;
const reserves = { reserveToken: 1_000n * whole, reserveQuote: 10n * whole };

// What the pair itself pays out for a sale's amount in.
function saleOut(swap: PairSwap | undefined): bigint | undefined {
  return swap === undefined ? undefined : pairAmountOut(swap.amountIn, 1_000n * whole, 10n * whole);
}

describe("swapToPrice", () => {
  it("answers nothing for a pair already at the target", () => {
    expect(swapToPrice(reserves, { numerator: 1n, denominator: 100n })).toBeUndefined();
  });

  it("buys the token to raise its price by a percent", () => {
    const swap = swapToPrice(reserves, { numerator: 101n, denominator: 10_000n });

    expect(swap?.side).toBe("buy");
    // About half a percent of the quote reserve, plus the 0.25% fee on it.
    expect(swap?.amountIn).toBeGreaterThan(49_875_621_120_890_200n);
    expect(swap?.amountIn).toBeLessThan(50_100_000_000_000_000n);
  });

  it("sells the token to lower its price", () => {
    const swap = swapToPrice(reserves, { numerator: 99n, denominator: 10_000n });

    expect(swap?.side).toBe("sell");
    expect(swap?.amountOut).toBe(saleOut(swap));
  });

  it("moves the price by a base unit when the target is a hair above it", () => {
    const target = { numerator: 10n * whole + 1n, denominator: 1_000n * whole };

    expect(swapToPrice(reserves, target)).toStrictEqual({
      side: "buy",
      amountIn: 1n,
      amountOut: 99n,
    });
  });
});

describe("pairAmountOut", () => {
  it("keeps 25 of every 10,000 put in as its fee", () => {
    expect(pairAmountOut(10_000n, 10n ** 30n, 10n ** 30n)).toBe(9_974n);
  });
});
