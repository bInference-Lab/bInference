import type { AssetRef } from "@binference/chain";
import { priceSourceContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { createFakePriceSource } from "./fake-price-source.js";

const coin = "fake:1/slip44:1" as AssetRef;
const token = "fake:1/token:a" as AssetRef;

function create() {
  return createFakePriceSource(new Map([[coin, { numerator: 600n, denominator: 10n ** 12n }]]));
}

describe("fake price source", () => {
  it.each(
    priceSourceContract({ create: () => ({ source: create(), known: coin, unknown: token }) }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("records the assets it was asked to price", async () => {
    const source = create();
    const signal = new AbortController().signal;
    await source.usdPrice(token, { signal });
    await source.usdPrice(coin, { signal });
    expect(source.asked()).toStrictEqual([token, coin]);
  });

  it("keeps only the last 1,000 assets it was asked for", async () => {
    const source = create();
    const signal = new AbortController().signal;
    const assets = [token, ...Array.from({ length: 1_000 }, () => coin)];
    await Promise.all(assets.map(async (asset) => source.usdPrice(asset, { signal })));
    expect(source.asked()).toHaveLength(1_000);
    expect(source.asked()).not.toContain(token);
  });
});
