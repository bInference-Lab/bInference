import { assetRefSchema, type ChainRef } from "@binference/chain";
import { poolSource, type WatchedPrice } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { WatchedOrderPrice } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import type { ChainWatch, LatestPrice } from "./chain-watch.js";
import { createClosers } from "./closers.js";
import { seeOrdersAndAlerts, startPriceTriggers, triggerPriceOf } from "./price-triggers.js";

const chain = "eip155:56" as ChainRef;
const bsc = assetRefSchema.parse("eip155:56/slip44:714");
const token = assetRefSchema.parse("eip155:56/erc20:0x0000000000000000000000000000000000000001");
const nowMs = 1_800_000_000_000;
// $2 a whole token of 18 decimals on its launchpad's curve, confirmed as read.
const curve: LatestPrice = {
  token,
  block: 100n,
  atMs: nowMs,
  askedAtMs: nowMs,
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
    chain: { ref: chain, definition: { blockTimeMs: 450 } },
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

// A chain head no test waits on.
const anyHead = async () => Promise.resolve(0n);

describe("the hand-off of watched prices to the price triggers", () => {
  it("hands on a confirmed price with its decimals, and whether a thin pool priced it", () => {
    const known = { checks: [], decimals, nowMs };
    expect(triggerPriceOf(curve, known)).toStrictEqual({
      token,
      usdPerBaseUnit: curve.usdPrice,
      decimals: 18,
      isThin: true,
      readAtMs: nowMs,
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
    startPriceTriggers(
      { watches, decimals, checks: () => [], clock, link, readHead: anyHead },
      { closers, logger },
    );

    fake.read(curve);
    fake.read({ ...curve, source: poolSource });
    await Promise.resolve();
    await Promise.resolve();
    await closers.closeAll(new AbortController().signal);

    expect(seen).toStrictEqual([
      { token, usdPerBaseUnit: curve.usdPrice, decimals: 18, isThin: true, readAtMs: nowMs },
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

// A hand-off whose engine records when each price's read was asked, after the test's start, and
// whose chain head the test answers.
function pausedHandOff() {
  const fake = fakeWatch();
  const seen: bigint[] = [];
  const heads: ((head: bigint) => void)[] = [];
  const isPaused = { now: false };
  const link = {
    see: async (_price: WatchedOrderPrice) => Promise.resolve([]),
    pauses: () => isPaused.now,
  };
  const logger = createMemoryLogger({ subsystem: "watcher" });
  const closers = createClosers();
  const clock = createManualClock(nowMs);
  const readHead = async () => new Promise<bigint>((resolve) => heads.push(resolve));
  const fence = startPriceTriggers(
    {
      watches: new Map([[chain, fake.watch]]),
      decimals,
      checks: () => [],
      clock,
      link,
      readHead,
    },
    { closers, logger },
  );
  link.see = async (price) => {
    seen.push(BigInt(price.readAtMs - nowMs));
    return Promise.resolve([]);
  };
  const read = (block: bigint, askedAtMs = clock.now()): void =>
    fake.read({ ...curve, block, atMs: clock.now(), askedAtMs });
  return { fence, read, seen, heads, isPaused, clock, closers };
}

describe("the hand-off around a pause of the engine", () => {
  it("drops a price that finds a pause, and one whose read was asked a minute before or later", async () => {
    const run = pausedHandOff();
    run.isPaused.now = true;
    run.read(100n);
    run.isPaused.now = false;
    await run.clock.advance(61_000);
    run.read(101n, nowMs);
    run.read(102n, run.clock.now() + 1);
    run.read(103n);
    await run.closers.closeAll(new AbortController().signal);

    expect(run.seen).toStrictEqual([61_000n]);
  });

  it("after a pause, drops every price until a head read after it answers, then those below it", async () => {
    const run = pausedHandOff();
    run.fence.afterPause();
    run.read(500n);
    await run.clock.advance(0);
    run.heads[0]?.(600n);
    await run.clock.advance(0);
    run.read(599n);
    run.read(600n);
    await run.closers.closeAll(new AbortController().signal);

    expect(run.seen).toStrictEqual([0n]);
  });
});

const failing = async () =>
  Promise.reject(new BinferenceError({ code: "store.down", message: "down" }));

describe("seeOrdersAndAlerts", () => {
  const price: WatchedOrderPrice = {
    token,
    usdPerBaseUnit: { numerator: 1n, denominator: 1n },
    decimals: 18,
    isThin: false,
    readAtMs: 0,
  };
  const call = { signal: new AbortController().signal };

  it("hands each price to the order triggers and the alerts, and answers the orders' outcomes", async () => {
    const seen: string[] = [];
    const see = seeOrdersAndAlerts({
      seePrice: async () => {
        seen.push("orders");
        return Promise.resolve([]);
      },
      alerts: {
        seePrice: async () => {
          seen.push("alerts");
          return Promise.resolve([]);
        },
      } as never,
    });

    await expect(see(price, call)).resolves.toStrictEqual([]);
    expect(seen.toSorted()).toStrictEqual(["alerts", "orders"]);
  });

  it("lets the order triggers run when the alerts fail, then throws the failure", async () => {
    const seen: string[] = [];
    const see = seeOrdersAndAlerts({
      seePrice: async () => {
        seen.push("orders");
        return Promise.resolve([]);
      },
      alerts: { seePrice: failing } as never,
    });

    await expect(see(price, call)).rejects.toMatchObject({ code: "store.down" });
    expect(seen).toStrictEqual(["orders"]);
  });
});
