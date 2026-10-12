import { assetRefSchema, type ChainRef } from "@binference/chain";
import { poolSource, type WatchedPrice } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { WatchedOrderPrice } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import type { ChainWatch, LatestPrice } from "./chain-watch.js";
import { createClosers } from "./closers.js";
import { startPriceTriggers, triggerPriceOf } from "./price-triggers.js";

const chain = "eip155:56" as ChainRef;
const bsc = assetRefSchema.parse("eip155:56/slip44:714");
const token = assetRefSchema.parse("eip155:56/erc20:0x0000000000000000000000000000000000000001");
const nowMs = 1_800_000_000_000;
// $2 a whole token of 18 decimals on its launchpad's curve, confirmed as read.
const curve: LatestPrice = {
  token,
  block: 100n,
  atMs: nowMs,
  source: "flap",
  plan: "flap:0x0000000000000000000000000000000000000003",
  quoteAsset: bsc,
  quotePrice: { numerator: 1n, denominator: 300n },
  usdPrice: { numerator: 2_000_000n, denominator: 10n ** 18n },
  planSinceMs: nowMs,
};
const decimals = new Map([[token, 18]]);

/** A chain watch whose watcher hands on the prices a test reads, and keeps them as latest. */
function fakeWatch() {
  const listeners = new Set<(price: WatchedPrice) => void>();
  const latest: LatestPrice[] = [];
  const watch = {
    watcher: {
      onPrice(listener: (price: WatchedPrice) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    latest: () => latest,
  } as unknown as ChainWatch;
  const read = (price: LatestPrice): void => {
    latest.splice(0, latest.length, price);
    listeners.forEach((listener) => {
      listener(price);
    });
  };
  return { watch, read, listeners };
}

describe("the hand-off of watched prices to the price triggers", () => {
  it("hands on a confirmed price with its decimals, and whether a thin pool priced it", () => {
    const known = { checks: [], decimals, nowMs };
    expect(triggerPriceOf(curve, known)).toStrictEqual({
      token,
      usdPerBaseUnit: curve.usdPrice,
      decimals: 18,
      isThin: true,
    });
    const pool = { ...curve, source: poolSource };
    const { usdPrice: _usd, ...unvalued } = curve;
    expect([
      triggerPriceOf(pool, known),
      triggerPriceOf(unvalued, known),
      triggerPriceOf(curve, { ...known, decimals: new Map() }),
    ]).toStrictEqual([undefined, undefined, undefined]);
  });

  it("sends each confirmed price to the engine as it is read, logs a failure and stops at shutdown", async () => {
    const fake = fakeWatch();
    const seen: WatchedOrderPrice[] = [];
    const link = {
      see: async (price: WatchedOrderPrice) => {
        seen.push(price);
        return await Promise.reject(new BinferenceError({ code: "engine.test", message: "no" }));
      },
    };
    const logger = createMemoryLogger({ subsystem: "watcher" });
    const closers = createClosers();
    const watches = new Map([[chain, fake.watch]]);
    const clock = createManualClock(nowMs);
    startPriceTriggers({ watches, decimals, checks: () => [], clock, link }, { closers, logger });

    fake.read(curve);
    fake.read({ ...curve, source: poolSource });
    await Promise.resolve();
    await Promise.resolve();
    await closers.closeAll(new AbortController().signal);

    expect(seen).toStrictEqual([
      { token, usdPerBaseUnit: curve.usdPrice, decimals: 18, isThin: true },
    ]);
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "engine.trigger_failed",
        fields: { errorCode: "engine.test" },
      }),
    );
    expect(fake.listeners.size).toBe(0);
  });
});
