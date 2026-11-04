import { type AssetRef, assetRefSchema, type PriceSource } from "@binference/chain";
import type { ReceiptPool, StakingVenue } from "@binference/chain/staking";
import { priceSourceContract } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin, testToken } from "../intents/test-intents.js";
import { createStakingHost } from "../venues/staking-host.js";
import { poolPriced, stakePricesOf } from "./stake-prices.js";
import { stakingChains, testStakingFake, testValidator } from "./test-stakes.js";

const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const unlisted = assetRefSchema.parse("fake:1/token:0x00000bad");
const live = { signal: new AbortController().signal };
// $600 a whole coin: 600 micro-dollars for 10^12 base units.
const coinPrice = { numerator: 600n, denominator: 10n ** 12n };
const pool: ReceiptPool = {
  validator: testValidator,
  pool: { shares: { asset: receipt, base: 100n }, coin: { asset: testCoin, base: 105n } },
};

function pricesOf(known: ReadonlyMap<AssetRef, typeof coinPrice>): PriceSource {
  return {
    usdPrice: async (asset) => {
      const price = known.get(asset);
      return Promise.resolve(
        price === undefined ? { ok: false, error: "no_price" } : { ok: true, value: price },
      );
    },
  };
}

function partsOf(
  answer: (receipts: readonly AssetRef[]) => Promise<readonly ReceiptPool[]>,
  known: ReadonlyMap<AssetRef, typeof coinPrice> = new Map([[testCoin, coinPrice]]),
) {
  const asked: (readonly AssetRef[])[] = [];
  const venue: StakingVenue = {
    ...testStakingFake(),
    pools: async (receipts) => {
      asked.push(receipts);
      return answer(receipts);
    },
  };
  const chains = stakingChains();
  const staking = createStakingHost({ venues: [venue], chains, clock: createManualClock(1) });
  return { parts: { staking, chains, prices: pricesOf(known) }, asked };
}

describe("pricing receipt tokens by their pool", () => {
  it.each(
    priceSourceContract({
      create: () => ({
        source: poolPriced(
          pricesOf(new Map([[testCoin, coinPrice]])),
          new Map([[receipt, { venue: "fake-staking", ...pool }]]),
        ),
        known: receipt,
        unknown: unlisted,
      }),
    }),
  )("follows the price source contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices a receipt at the coin's price times its pool's coin over its units", async () => {
    const { parts, asked } = partsOf(async () => Promise.resolve([pool]));
    const { prices } = await stakePricesOf(parts, [testCoin, testToken, receipt, receipt], live);
    expect(asked).toStrictEqual([[receipt]]);
    expect(await prices.usdPrice(receipt, live)).toStrictEqual({
      ok: true,
      value: { numerator: 600n * 105n, denominator: 10n ** 12n * 100n },
    });
    expect(await prices.usdPrice(testCoin, live)).toStrictEqual({ ok: true, value: coinPrice });
  });

  it("asks no venue for the registry's tokens and the coin alone", async () => {
    const { parts, asked } = partsOf(async () => Promise.reject(new Error("asked")));
    const read = await stakePricesOf(parts, [testCoin, testToken], live);
    expect([read.pools.size, asked]).toStrictEqual([0, []]);
  });

  it("leaves a token no pool names to the price source, and a receipt unpriced with no coin price", async () => {
    const { parts } = partsOf(async () => Promise.resolve([pool]), new Map());
    const { prices } = await stakePricesOf(parts, [receipt, unlisted], live);
    expect(await prices.usdPrice(receipt, live)).toStrictEqual({ ok: false, error: "no_price" });
    expect(await prices.usdPrice(unlisted, live)).toStrictEqual({ ok: false, error: "no_price" });
  });

  it("leaves a receipt unpriced while its coin's price is no usable price", async () => {
    const zero = { numerator: 0n, denominator: 1n };
    const { parts } = partsOf(async () => Promise.resolve([pool]), new Map([[testCoin, zero]]));
    const { prices } = await stakePricesOf(parts, [receipt], live);
    expect(await prices.usdPrice(receipt, live)).toStrictEqual({ ok: false, error: "no_price" });
  });

  it("leaves a receipt unpriced when its venue does not answer", async () => {
    const { parts } = partsOf(async () => Promise.reject(new Error("down")));
    const { pools, prices } = await stakePricesOf(parts, [receipt], live);
    expect(pools.size).toBe(0);
    expect(await prices.usdPrice(receipt, live)).toStrictEqual({ ok: false, error: "no_price" });
  });
});
