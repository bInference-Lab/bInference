import { assetRefSchema } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { createChartPools } from "./chart-pools.js";

const tokenOf = (index: number) =>
  assetRefSchema.parse(`eip155:56/erc20:0x${index.toString(16).padStart(40, "0")}`);

describe("chart pools", () => {
  it("keeps a token's pool until its time is up", () => {
    const pools = createChartPools({ ttlMs: 1_000, maxEntries: 2 });
    pools.set(tokenOf(1), "0x0a", 0);
    expect([pools.get(tokenOf(1), 999), pools.get(tokenOf(1), 1_000)]).toStrictEqual([
      "0x0a",
      undefined,
    ]);
  });

  it("forgets the oldest pick past its most, and a pick kept again counts as new", () => {
    const pools = createChartPools({ ttlMs: 1_000, maxEntries: 2 });
    pools.set(tokenOf(1), "0x0a", 0);
    pools.set(tokenOf(2), "0x0b", 0);
    pools.set(tokenOf(1), "0x0c", 1);
    pools.set(tokenOf(3), "0x0d", 2);
    expect([1, 2, 3].map((index) => pools.get(tokenOf(index), 2))).toStrictEqual([
      "0x0c",
      undefined,
      "0x0d",
    ]);
  });
});
