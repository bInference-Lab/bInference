import { assetRefSchema, type AssetRef, type RegisteredChain } from "@binference/chain";
import type {
  PlanPrices,
  PricePlan,
  PriceWatcher,
  WatchedPrice,
  WatchedToken,
} from "@binference/chain-evm";
import { BinferenceError, err, ok } from "@binference/core";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createChainWatch } from "./chain-watch.js";

const chain = {
  ref: "eip155:56",
  definition: { name: "BNB Smart Chain" },
} as unknown as RegisteredChain;
const tokenOf = (byte: string): AssetRef =>
  assetRefSchema.parse(`eip155:56/erc20:0x00000000000000000000000000000000000000${byte}`);

// A planner that finds a read for one token only, and notes each token it is asked about.
function plansOnly(priced: AssetRef, asked: AssetRef[]): PlanPrices {
  const read = { source: "pools", read: {} } as unknown as PricePlan;
  return async (token) => {
    asked.push(token);
    return await Promise.resolve(token === priced ? ok(read) : err("no_price_read"));
  };
}

// A planner that finds no read for any token.
const noPlan: PlanPrices = async () => await Promise.resolve(err("no_price_read"));

const poolPlan = "pools:0x00000000000000000000000000000000000000ee";
const otherPlan = "pools:0x00000000000000000000000000000000000000ef";

/** A watcher a test drives: it counts runs and watches, and hands on the prices the test makes. */
function fakeWatcher(options: { readonly failsWith?: Error; readonly failures?: number } = {}) {
  const listeners = new Set<(price: WatchedPrice) => void>();
  const watches = new Map<AssetRef, number>();
  const state = { runs: 0, running: 0 };
  // Where each token stands; a token not set is priced by the pools' plan.
  const standing = new Map<AssetRef, WatchedToken>();
  const watcher: PriceWatcher = {
    watch(token) {
      watches.set(token, (watches.get(token) ?? 0) + 1);
      return () => watches.set(token, (watches.get(token) ?? 1) - 1);
    },
    onPrice(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tokens: () =>
      [...watches.keys()].map(
        (token) =>
          standing.get(token) ?? { token, state: "priced", source: "pools", plan: poolPlan },
      ),
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
  const emit = (token: AssetRef, block: bigint, by: { plan?: string; atMs?: number } = {}) =>
    listeners.forEach((listener) =>
      listener({
        token,
        block,
        atMs: by.atMs ?? 1,
        askedAtMs: by.atMs ?? 1,
        source: "pools",
        plan: by.plan ?? poolPlan,
        quoteAsset: tokenOf("ff"),
        quotePrice: { numerator: 1n, denominator: 1n },
      }),
    );
  return { watcher, watches, state, emit, standing };
}

describe("a chain's price watch", () => {
  it("runs the watcher while any token is watched, and keeps each one's latest price", async () => {
    const fake = fakeWatcher();
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      planPrices: noPlan,
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

  it("keeps a latest price only while the watcher prices the token by the plan that read it", async () => {
    const fake = fakeWatcher();
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      planPrices: noPlan,
      logger: createMemoryLogger({ subsystem: "watcher" }),
      clock: createManualClock(0),
    });
    watch.watch(tokenOf("01"));
    fake.emit(tokenOf("01"), 7n, { atMs: 10 });
    fake.emit(tokenOf("01"), 8n, { atMs: 20 });
    expect(watch.latest().map(({ block, planSinceMs }) => [block, planSinceMs])).toStrictEqual([
      [8n, 10],
    ]);
    fake.standing.set(tokenOf("01"), { token: tokenOf("01"), state: "unpriced" });
    expect(watch.latest()).toStrictEqual([]);
    const repriced = { token: tokenOf("01"), state: "priced", source: "pools" } as const;
    fake.standing.set(tokenOf("01"), { ...repriced, plan: otherPlan });
    expect(watch.latest()).toStrictEqual([]);
    fake.emit(tokenOf("01"), 9n, { plan: otherPlan, atMs: 30 });
    expect(watch.latest().map(({ block, planSinceMs }) => [block, planSinceMs])).toStrictEqual([
      [9n, 30],
    ]);
  });

  it("can price a token it prices now, or one a read would price, and no other", async () => {
    const fake = fakeWatcher();
    const asked: AssetRef[] = [];
    const planPrices = plansOnly(tokenOf("02"), asked);
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      planPrices,
      logger: createMemoryLogger({ subsystem: "watcher" }),
      clock: createManualClock(0),
    });
    watch.watch(tokenOf("01"));
    const live = new AbortController().signal;
    const answers = await Promise.all(
      ["01", "02", "03"].map(async (byte) => watch.canPrice(tokenOf(byte), live)),
    );
    expect(answers).toStrictEqual([true, true, false]);
    expect(asked).toStrictEqual([tokenOf("02"), tokenOf("03")]);
  });

  it("logs a watcher that stops on a fault, and restarts it with a growing wait", async () => {
    const fault = new BinferenceError({ code: "chain.multicall_mismatch", message: "broken" });
    const fake = fakeWatcher({ failsWith: fault });
    const logger = createMemoryLogger({ subsystem: "watcher" });
    const clock = createManualClock(0);
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      planPrices: noPlan,
      logger,
      clock,
    });
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
    const watch = createChainWatch({
      chain,
      watcher: fake.watcher,
      planPrices: noPlan,
      logger,
      clock,
    });
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
    const quiet = createChainWatch({
      chain,
      watcher: failing.watcher,
      planPrices: noPlan,
      logger,
      clock,
    });
    const once = quiet.watch(tokenOf("02"));
    await clock.advance(0);
    once();
    await clock.advance(60_000);
    expect([failing.state.runs, quiet.downSinceMs()]).toStrictEqual([1, undefined]);
  });
});
