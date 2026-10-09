import { describe, expect, it } from "vitest";
import { hookedDexIds, hookedSourcesIn } from "./hooked-sources.js";

describe("okx hooked sources", () => {
  it("names the protocols whose pools run hooks: PancakeSwap Infinity and Uniswap v4", () => {
    const sources = [
      "PancakeSwap V3",
      "PancakeSwap Infinity CL",
      "PancakeSwap Infinity Bin",
      "Uniswap V4",
      "Uniswap V3",
      "Thena V2",
    ];
    expect(hookedSourcesIn(sources)).toStrictEqual([
      "PancakeSwap Infinity CL",
      "PancakeSwap Infinity Bin",
      "Uniswap V4",
    ]);
  });

  it("gives the DEX ids of those protocols from OKX's liquidity list", () => {
    const list = [
      { id: "1", name: "Uniswap V3" },
      { id: "190", name: "PancakeSwap Infinity CL" },
      { id: "191", name: "Uniswap V4" },
    ];
    expect(hookedDexIds(list)).toStrictEqual(["190", "191"]);
  });
});
