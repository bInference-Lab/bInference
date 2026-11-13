import { describe, expect, it } from "vitest";
import { inputOf, limitChangeOf } from "./limit-input";

const usdt = "eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955";

describe("a limit as the owner types it", () => {
  it("writes each unit as the owner types it back", () => {
    expect(inputOf("perTradeUsdMicros", 12_500_000n)).toBe("12.5");
    expect(inputOf("slippageRegistryBps", 50)).toBe("0.5");
    expect(inputOf("cardTradeExpirySeconds", 60)).toBe("60");
    expect(inputOf("venues", ["pancakeswap", "kyberswap"])).toBe("pancakeswap, kyberswap");
    expect(inputOf("allowTokens", [])).toBe("");
  });

  it("reads dollars, a percent, seconds, days and lists as the change limit/set takes", () => {
    expect(limitChangeOf("perTradeUsdMicros", " $50 ")).toStrictEqual({
      perTradeUsdMicros: 50_000_000n,
    });
    expect(limitChangeOf("rollingDayUsdMicros", "0.000001")).toStrictEqual({
      rollingDayUsdMicros: 1n,
    });
    expect(limitChangeOf("slippageOtherBps", "1.25%")).toStrictEqual({ slippageOtherBps: 125 });
    expect(limitChangeOf("orderExpiryDays", "7")).toStrictEqual({ orderExpiryDays: 7 });
    expect(limitChangeOf("venues", "pancakeswap, , kyberswap")).toStrictEqual({
      venues: ["pancakeswap", "kyberswap"],
    });
    expect(limitChangeOf("allowTokens", "")).toStrictEqual({ allowTokens: [] });
    expect(limitChangeOf("denyTokens", usdt)).toStrictEqual({ denyTokens: [usdt] });
  });

  it("refuses what the limit does not take before anything is sent", () => {
    expect(limitChangeOf("perTradeUsdMicros", "fifty")).toBeUndefined();
    expect(limitChangeOf("perTradeUsdMicros", "0.0000001")).toBeUndefined();
    expect(limitChangeOf("taxBps", "100.01")).toBeUndefined();
    expect(limitChangeOf("taxBps", "0.005")).toBeUndefined();
    expect(limitChangeOf("cardOtherExpirySeconds", "0")).toBeUndefined();
    expect(limitChangeOf("orderExpiryDays", "1.5")).toBeUndefined();
    expect(limitChangeOf("denyTokens", "USDT")).toBeUndefined();
  });
});
