import {
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  type RegisteredChain,
} from "@binference/chain";
import type { WatcherLag } from "@binference/chain-evm";
import { createFakeMarketSource } from "@binference/chain/testing";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { EnginePush } from "@binference/engine";
import type { OrderRecord } from "@binference/engine/orders";
import { describe, expect, it } from "vitest";
import type { ChainWatch, LatestPrice } from "./chain-watch.js";
import { createClosers } from "./closers.js";
import { composePriceWatchers } from "./compose-price-watchers.js";

const bsc = "eip155:56" as ChainRef;
const token = assetRefSchema.parse("eip155:56/erc20:0x0000000000000000000000000000000000000001");
const startMs = 1_800_000_000_000;
// $2 a whole token of 18 decimals, as the watcher read it.
const watched: LatestPrice = {
  token,
  block: 100n,
  atMs: startMs,
  source: "pools",
  plan: "pools:0x0000000000000000000000000000000000000002",
  quoteAsset: assetRefSchema.parse("eip155:56/slip44:714"),
  quotePrice: { numerator: 1n, denominator: 300n },
  usdPrice: { numerator: 2_000_000n, denominator: 10n ** 18n },
  planSinceMs: startMs,
};

/** A chain watch a test steers: its lag, whether it runs, its latest prices and its watches. */
function fakeWatch() {
  const state = {
    lag: 0n,
    latest: [] as LatestPrice[],
    watches: [] as AssetRef[],
    closed: 0,
    downSinceMs: undefined as number | undefined,
  };
  const watch = {
    chain: { ref: bsc, definition: { name: "BNB Smart Chain" } } as unknown as RegisteredChain,
    watcher: {
      lag: (): WatcherLag => ({
        lagBlocks: state.lag,
        skippedBlocks: 0n,
        source: { mode: "polling" },
      }),
      tokens: () => state.watches.map((asset) => ({ token: asset, state: "priced" })),
      onPrice: () => () => undefined,
    },
    watch(asset: AssetRef) {
      state.watches.push(asset);
      return () => undefined;
    },
    isRunning: () => state.watches.length > 0 && state.downSinceMs === undefined,
    downSinceMs: () => state.downSinceMs,
    latest: () => state.latest,
    close: async () => {
      state.closed += 1;
      return await Promise.resolve();
    },
  } as unknown as ChainWatch;
  return { watch, state };
}

// An order store that answers only when the signal aborts, as one that hangs.
async function hanging(signal: AbortSignal): Promise<never> {
  return await new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });
}

function rig(options: { readonly dexscreenerUsd?: bigint; readonly isStoreStuck?: boolean } = {}) {
  const clock = createManualClock(startMs);
  const fake = fakeWatch();
  const pushes: EnginePush[] = [];
  const logger = createMemoryLogger({ subsystem: "watcher" });
  const prices = new Map([[token, { numerator: options.dexscreenerUsd ?? 2n, denominator: 1n }]]);
  const watchers = composePriceWatchers({
    watches: new Map([[bsc, fake.watch]]),
    decimals: async (tokens) => await Promise.resolve(new Map(tokens.map((each) => [each, 18]))),
    orders: {
      list: async (_query, { signal }) =>
        options.isStoreStuck === true
          ? await hanging(signal)
          : await Promise.resolve([
              {
                id: "ord_1",
                kind: "stopLoss",
                createdAtMs: 1,
                request: { kind: "stopLoss", token },
              },
            ] as unknown as readonly OrderRecord[]),
    },
    sources: {
      dexscreener: createFakeMarketSource({ id: "dexscreener", chains: [bsc], prices }),
      geckoterminal: createFakeMarketSource({ id: "geckoterminal", chains: [bsc] }),
    },
    clock,
    publish: (push) => pushes.push(push),
  });
  const closers = createClosers();
  watchers.start(closers, logger);
  return { clock, fake, pushes, logger, watchers, closers };
}

describe("the composed price watchers", () => {
  it("gives an ok signal with no lag while no watcher reads", () => {
    const { watchers } = rig();
    expect(watchers.health()).toStrictEqual({ signal: "watcher", state: "ok" });
  });

  it("watches the active orders' tokens, and shows the lag and tells the owner when it stays", async () => {
    const { clock, fake, watchers, pushes } = rig();
    await clock.advance(1_000);
    expect(fake.state.watches).toStrictEqual([token]);
    expect(watchers.activeOrders()).toBe(1);
    await clock.advance(1_000);
    expect(watchers.health()).toStrictEqual({ signal: "watcher", state: "ok", lagBlocks: 0 });
    fake.state.lag = 25n;
    await clock.advance(1_000);
    expect(watchers.health()).toStrictEqual({
      signal: "watcher",
      state: "fail",
      since: startMs + 3_000,
      lagBlocks: 25,
    });
    await clock.advance(30_000);
    expect(pushes).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: "notice.watcherLag", values: { chain: "BNB Smart Chain", blocks: "25" } },
      },
    ]);
  });

  it("flags a price 10% or more from a source's as a warning, and logs it", async () => {
    const { clock, fake, watchers, logger } = rig({ dexscreenerUsd: 3n });
    fake.state.latest = [watched];
    await clock.advance(15_000);
    expect(watchers.health()).toStrictEqual({ signal: "watcher", state: "warn", lagBlocks: 0 });
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "watcher.price_gap",
        fields: { assetId: token, sourceId: "dexscreener", gapBps: 3_333 },
      }),
    );
  });

  it("hands a trigger a pool's price only once the cross-check proved it", async () => {
    const { clock, fake, watchers } = rig();
    fake.state.latest = [watched];
    expect(watchers.confirmedPrices()).toStrictEqual([]);
    await clock.advance(15_000);
    expect(watchers.confirmedPrices()).toStrictEqual([watched]);
  });

  it("counts a watched token without a confirmed price for a minute, warns and tells the owner once", async () => {
    // The token is watched from the sync at 1 s and seen unpriced from 2 s.
    const { clock, fake, watchers, pushes } = rig();
    await clock.advance(60_000);
    expect(watchers.health()).toStrictEqual({ signal: "watcher", state: "ok", lagBlocks: 0 });
    await clock.advance(2_000);
    expect(watchers.health()).toStrictEqual({
      signal: "watcher",
      state: "warn",
      since: startMs + 62_000,
      lagBlocks: 0,
      unpricedTokens: 1,
    });
    await clock.advance(60_000);
    const unpriced = {
      topic: "notice",
      kind: "notice/new",
      data: {
        key: "notice.watcherUnpriced",
        values: { chain: "BNB Smart Chain", count: "1", token: "0x0000…0001" },
      },
    };
    expect(pushes).toStrictEqual([unpriced]);
    fake.state.latest = [watched];
    await clock.advance(60_000);
    expect(watchers.health()).toStrictEqual({ signal: "watcher", state: "ok", lagBlocks: 0 });
  });

  it("checks the watchers each second while the order store hangs, and gives the sync 10 seconds", async () => {
    const { clock, fake, pushes, logger } = rig({ isStoreStuck: true });
    fake.state.watches = [token];
    await clock.advance(1_500);
    fake.state.downSinceMs = startMs + 1_500;
    await clock.advance(1_500);
    expect(pushes.map(({ data }) => (data as { key: string }).key)).toStrictEqual([
      "notice.watcherStopped",
    ]);
    await clock.advance(10_000);
    expect(logger.records()).toContainEqual(
      expect.objectContaining({
        event: "engine.watcher_sync_failed",
        fields: { errorCode: "core.timeout" },
      }),
    );
  });

  it("stops every watcher when the engine shuts down", async () => {
    const { fake, closers } = rig();
    await closers.closeAll(new AbortController().signal);
    expect(fake.state.closed).toBe(1);
  });

  it("fails while a watcher is down and tells the owner at once", async () => {
    const { clock, fake, watchers, pushes } = rig();
    await clock.advance(1_000);
    fake.state.downSinceMs = startMs + 1_500;
    await clock.advance(1_000);
    expect(watchers.health()).toStrictEqual({
      signal: "watcher",
      state: "fail",
      since: startMs + 2_000,
      lagBlocks: 0,
    });
    expect(pushes).toStrictEqual([
      {
        topic: "notice",
        kind: "notice/new",
        data: { key: "notice.watcherStopped", values: { chain: "BNB Smart Chain" } },
      },
    ]);
  });
});
