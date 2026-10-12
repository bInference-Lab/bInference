import { describe, expect, it } from "vitest";
import { curveImpactBps } from "./price-impact.js";

const wad = 10n ** 18n;

describe("curve price impact", () => {
  it("leaves out a buy's tax, a share of its input", () => {
    // 1 coin at 1 coin a token, 3% tax and 1% fee taken from the input: 0.96 tokens out.
    const trade = {
      side: "buy",
      amountIn: wad,
      amountOut: (wad * 96n) / 100n,
      price: wad,
    } as const;
    expect(curveImpactBps({ ...trade, taxBps: 300n })).toBe(100);
    expect(curveImpactBps({ ...trade, taxBps: 0n })).toBe(400);
  });

  it("leaves out at most a sale's tax on its proceeds", () => {
    // 1 token at 1 coin, 3% tax and 1% fee taken from the proceeds: 0.96 coin out.
    const trade = {
      side: "sell",
      amountIn: wad,
      amountOut: (wad * 96n) / 100n,
      price: wad,
    } as const;
    expect(curveImpactBps({ ...trade, taxBps: 300n })).toBe(104);
  });

  it("rounds a loss up, and a gain to none", () => {
    const buy = { side: "buy", amountIn: 10_001n, price: wad, taxBps: 0n } as const;
    expect(curveImpactBps({ ...buy, amountOut: 10_000n })).toBe(1);
    expect(curveImpactBps({ ...buy, amountOut: 20_000n })).toBe(0);
  });

  it.each([
    ["no price", { price: 0n, amountIn: wad, taxBps: 0n }],
    ["no input", { price: wad, amountIn: 0n, taxBps: 0n }],
    ["a tax of the whole trade", { price: wad, amountIn: wad, taxBps: 10_000n }],
  ])("counts a trade with %s as the whole input", (_case, change) => {
    expect(curveImpactBps({ side: "sell", amountOut: wad, ...change })).toBe(10_000);
  });
});
