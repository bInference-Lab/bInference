import { describe, expect, it } from "vitest";
import { curveImpactBps } from "./price-impact.js";

const wad = 10n ** 18n;
// A curve priced at one quote unit for one token unit.
const even = { quoteReserve: 6n * wad, tokenReserve: 6n * wad };

describe("curve price impact", () => {
  it("counts the fee and the curve's move on a buy, and leaves out the tax it pays", () => {
    const buy = { side: "buy", amountIn: wad, reserves: even } as const;
    // 2% fee and 3% tax off the input, the rest buying at no move: 0.95 tokens.
    const amountOut = (wad * 95n) / 100n;
    expect(curveImpactBps({ ...buy, amountOut, taxPaid: (wad * 3n) / 100n })).toBe(200);
    expect(curveImpactBps({ ...buy, amountOut, taxPaid: 0n })).toBe(500);
  });

  it("values a sale's input at the curve's price, and leaves out the tax off its proceeds", () => {
    const sale = { side: "sell", amountIn: wad, reserves: even } as const;
    const amountOut = (wad * 95n) / 100n;
    expect(curveImpactBps({ ...sale, amountOut, taxPaid: (wad * 3n) / 100n })).toBe(200);
  });

  it("rounds a loss up, and a gain to none", () => {
    const buy = { side: "buy", amountIn: 10_001n, reserves: even, taxPaid: 0n } as const;
    expect(curveImpactBps({ ...buy, amountOut: 10_000n })).toBe(1);
    expect(curveImpactBps({ ...buy, amountOut: 20_000n })).toBe(0);
  });

  it.each([
    [
      "an empty quote reserve",
      { reserves: { quoteReserve: 0n, tokenReserve: wad }, amountIn: wad },
    ],
    [
      "an empty token reserve",
      { reserves: { quoteReserve: wad, tokenReserve: 0n }, amountIn: wad },
    ],
    ["no input", { reserves: even, amountIn: 0n }],
  ])("counts a trade with %s as the whole input", (_case, change) => {
    expect(curveImpactBps({ side: "sell", amountOut: wad, taxPaid: 0n, ...change })).toBe(10_000);
  });
});
