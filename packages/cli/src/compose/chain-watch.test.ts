import { assetRefSchema, type AssetRef, type RegisteredChain } from "@binference/chain";
import type { PriceWatcher, WatchedPrice } from "@binference/chain-evm";
import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createChainWatch } from "./chain-watch.js";

const chain = {
  ref: "eip155:56",
  definition: { name: "BNB Smart Chain" },
} as unknown as RegisteredChain;
const tokenOf = (byte: string): AssetRef =>
  assetRefSchema.parse(`eip155:56/erc20:0x00000000000000000000000000000000000000${byte}`);

/** A watcher a test drives: it counts runs and watches, and hands on the prices the test makes. */
function fakeWatcher(options: { readonly failsWith?: Error } = {}) {
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
      if (options.failsWith !== undefined) {
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

  it("logs a watcher that stops on its own and runs it again at the next watch", async () => {
    const fault = new BinferenceError({ code: "chain.multicall_mismatch", message: "broken" });
    const fake = fakeWatcher({ failsWith: fault });
    const logger = createMemoryLogger({ subsystem: "watcher" });
    const watch = createChainWatch({ chain, watcher: fake.watcher, logger });
    watch.watch(tokenOf("01"));
    await Promise.resolve();
    await Promise.resolve();
    expect(watch.isRunning()).toBe(false);
    expect(logger.records()).toMatchObject([
      {
        level: "error",
        event: "engine.watcher_stopped",
        fields: { chain: "eip155:56", errorCode: "chain.multicall_mismatch" },
      },
    ]);
    watch.watch(tokenOf("02"));
    expect(fake.state.runs).toBe(2);
  });
});
