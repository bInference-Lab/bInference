import { assetRefSchema, type AssetRef, type RegisteredChain } from "@binference/chain";
import type { PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createChainWatch } from "./chain-watch.js";

const chain = {
  ref: "eip155:56",
  definition: { name: "BNB Smart Chain" },
} as unknown as RegisteredChain;
const tokenOf = (byte: string): AssetRef =>
  assetRefSchema.parse(`eip155:56/erc20:0x00000000000000000000000000000000000000${byte}`);

/** A watcher a test drives: it counts runs and watches, and hands on the prices the test makes. */
function fakeWatcher(options: { readonly failsWith?: Error; readonly failures?: number } = {}) {
  const listeners = new Set<(price: WatchedPrice) => void>();
  const watches = new Map<AssetRef, number>();
  const state = { runs: 0, running: 0 };
  const watcher: PriceWatcher = {
    watch(token) {
      watches.set(token, (watches.get(token) ?? 0) + 1);
      return () => watches.set(token, (watches.get(token) ?? 1) - 1);
    },
    onPrice(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tokens: () => [],
    lag: () => ({ lagBlocks: 0n, skippedBlocks: 0n, source: { mode: "polling" } }),
    async run(signal) {
      state.runs += 1;
      state.running += 1;
      if (options.failsWith !== undefined && state.runs <= (options.failures ?? Infinity)) {
        state.running -= 1;
        throw options.failsWith;
      }
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          state.running -= 1;
          reject(signal.reason);
        });
      });
    },
  };
  const emit = (token: AssetRef, block: bigint) =>
    listeners.forEach((listener) =>
      listener({
        token,
        block,
        atMs: 1,
        source: "pools",
        plan: "pools:0x00000000000000000000000000000000000000ee",
        quoteAsset: tokenOf("ff"),
        quotePrice: { numerator: 1n, denominator: 1n },
      }),
    );
  return { watcher, watches, state, emit };
}

describe("a chain's price watch", () => {
  it("runs the watcher while any token is watched, and keeps each one's latest price", async () => {
    const fake = fakeWatcher();
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      logger: createMemoryLogger({ subsystem: "watcher" }),
      clock: createManualClock(0),
    });
    expect(watch.isRunning()).toBe(false);
    const first = watch.watch(tokenOf("01"));
    const second = watch.watch(tokenOf("01"));
    const other = watch.watch(tokenOf("02"));
    expect([watch.isRunning(), fake.state.runs]).toStrictEqual([true, 1]);
    fake.emit(tokenOf("01"), 7n);
    fake.emit(tokenOf("03"), 7n);
    expect(watch.latest().map(({ token }) => token)).toStrictEqual([tokenOf("01")]);
    first();
    first();
    other();
    expect(watch.isRunning()).toBe(true);
    second();
    expect([watch.isRunning(), watch.latest()]).toStrictEqual([false, []]);
    expect(fake.watches).toStrictEqual(
      new Map([
        [tokenOf("01"), 0],
        [tokenOf("02"), 0],
      ]),
    );
    await watch.close();
    expect(fake.state.running).toBe(0);
  });

  it("logs a watcher that stops on a fault, and restarts it with a growing wait", async () => {
    const fault = new BinferenceError({ code: "chain.multicall_mismatch", message: "broken" });
    const fake = fakeWatcher({ failsWith: fault });
    const logger = createMemoryLogger({ subsystem: "watcher" });
    const clock = createManualClock(0);
    const watch = createChainWatch({ chain, watcher: fake.watcher, logger, clock });
    watch.watch(tokenOf("01"));
    await clock.advance(0);
    expect([watch.isRunning(), watch.downSinceMs()]).toStrictEqual([false, 0]);
    expect(logger.records()).toMatchObject([
      {
        level: "error",
        event: "engine.watcher_stopped",
        fields: { chain: "eip155:56", errorCode: "chain.multicall_mismatch" },
      },
    ]);
    await clock.advance(999);
    expect(fake.state.runs).toBe(1);
    await clock.advance(1);
    expect(fake.state.runs).toBe(2);
    await clock.advance(2_000);
    expect(fake.state.runs).toBe(3);
    await clock.advance(4_000);
    expect(fake.state.runs).toBe(4);
    expect(watch.downSinceMs()).toBe(0);
  });

  it("counts the watcher back up once a restart has run 30 seconds, and stops restarting with no token", async () => {
    const fake = fakeWatcher({ failsWith: new TypeError("once"), failures: 1 });
    const clock = createManualClock(0);
    const logger = createMemoryLogger({ subsystem: "watcher" });
    const watch = createChainWatch({ chain, watcher: fake.watcher, logger, clock });
    const release = watch.watch(tokenOf("01"));
    await clock.advance(1_000);
    expect(fake.state.runs).toBe(2);
    expect(watch.downSinceMs()).toBe(0);
    await clock.advance(30_000);
    expect(watch.downSinceMs()).toBeUndefined();
    release();
    await clock.advance(60_000);
    expect(fake.state.runs).toBe(2);

    const failing = fakeWatcher({ failsWith: new TypeError("always") });
    const quiet = createChainWatch({ chain, watcher: failing.watcher, logger, clock });
    const once = quiet.watch(tokenOf("02"));
    await clock.advance(0);
    once();
    await clock.advance(60_000);
    expect([failing.state.runs, quiet.downSinceMs()]).toStrictEqual([1, undefined]);
  });
});
