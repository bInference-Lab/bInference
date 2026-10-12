import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { marketDataSourceContract } from "../contracts/market-data-source-contract.js";
import { createFakeMarketSource, type FakeMarketSourceOptions } from "./fake-market-source.js";

const chain = chainRefSchema.parse("fake:1");
const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
const uncovered = assetRefSchema.parse("fake:2/token:0x0000000a");
const pool = {
  dex: "fake-swap",
  pool: "0x0000000d",
  base: known,
  quote: coin,
  priceUsd: { numerator: 3n, denominator: 2n },
  liquidityUsdMicros: 5_000_000n,
};
const options: FakeMarketSourceOptions = {
  id: "fake",
  chains: [chain],
  pools: new Map([[known, [pool]]]),
  trending: new Map([[chain, [{ asset: known, pool, activeBoosts: 3 }]]]),
};
const live = { signal: new AbortController().signal };

describe("fake market source", () => {
  it.each(
    marketDataSourceContract({
      create: () => ({
        source: createFakeMarketSource(options),
        known,
        unknown,
        uncovered,
        down: createFakeMarketSource({ ...options, isDown: true }),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("counts every read that reaches it, the refused ones too", async () => {
    const source = createFakeMarketSource({ ...options, isDown: true });
    await expect(source.pools(known, live)).rejects.toMatchObject({ code: "fake.unavailable" });
    await expect(source.trending(chain, live)).rejects.toMatchObject({ retryable: true });
    expect(source.reads()).toBe(2);
  });
});
