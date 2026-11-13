import { BinferenceError } from "@binference/core";
import { describe, expect, it, vi } from "vitest";
import type { BreakerState } from "../breaker/breaker-state.js";
import { plantWatched } from "../contracts/breaker-freeze-property.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { testWalletRecord } from "../install/test-wallet-record.js";
import { testAgent, testNowMs, testWallet } from "../intents/test-intents.js";
import {
  startTestEngine,
  type TestEngine,
  type TestEngineOptions,
} from "../operations/test-engine.js";
import type { BreakerSource, IntentStore } from "../ports.js";

const live = { signal: new AbortController().signal };
const pulled = (version: number): BreakerState => ({ pulled: true, version });
const lifted = (version: number): BreakerState => ({ pulled: false, version });

// A source that answers each state in turn, then the last one again.
function inTurn(states: readonly BreakerState[]): BreakerSource {
  const next = { at: 0 };
  return {
    read: async () => {
      const state = states[Math.min(next.at, states.length - 1)] ?? lifted(0);
      next.at += 1;
      return Promise.resolve(state);
    },
  };
}

// An intent store that holds the breaker's write of version `held` until its write of version
// `first` committed, as a write planned before another's commit and sent after it lands.
function holdingWrite(held: number, first: number): (store: IntentStore) => IntentStore {
  const opened = { open: (): void => undefined };
  const gate = new Promise<void>((resolve) => {
    opened.open = resolve;
  });
  return (store) => ({
    ...store,
    freeze: async (write, call) => {
      if (write.breaker?.version === held) {
        await gate;
      }
      const done = await store.freeze(write, call);
      if (done.ok && write.breaker?.version === first) {
        opened.open();
      }
      return done;
    },
  });
}

async function watchedEngine(options: TestEngineOptions): Promise<TestEngine> {
  const test = await startTestEngine(options);
  const wallet = { id: testWallet, agentId: testAgent, label: "main", createdAtMs: testNowMs };
  test.stores.install.addWallet(testWalletRecord(wallet));
  const first = { agentId: testAgent, walletId: testWallet };
  await plantWatched({ intents: test.stores.intents, orders: test.stores.orders, first });
  return test;
}

// Whether the breaker holds the install, its version, and the watched order's state.
async function heldOf(test: TestEngine) {
  const facts = await test.stores.install.read(live);
  const order = await test.stores.orders.get(fixtureId("ord", 1), live);
  return [facts.breakerAtMs !== undefined, facts.breakerVersion, order?.state];
}

// A source whose first read answers only once `release` is called, and that counts its reads.
function slowFirstRead() {
  const reads = { count: 0, release: (): void => undefined };
  const first = new Promise<BreakerState>((resolve) => {
    reads.release = () => resolve(pulled(1));
  });
  const breaker: BreakerSource = {
    read: async () => {
      reads.count += 1;
      return reads.count === 1 ? first : pulled(1);
    },
  };
  return { breaker, reads };
}

describe("looks at the breaker that overlap", () => {
  it("lift after a pull planned from the same version, so the paused order resumes", async () => {
    const breaker = inTurn([pulled(1), lifted(2)]);
    const test = await watchedEngine({ breaker, intents: holdingWrite(2, 1) });
    await Promise.all([test.engine.followBreaker(live), test.engine.followBreaker(live)]);
    await expect(heldOf(test)).resolves.toStrictEqual([false, 2, "active"]);
  });

  it("pull after a lift planned from the same version, so the resumed order pauses", async () => {
    const breaker = inTurn([pulled(1), lifted(2), pulled(3)]);
    const test = await watchedEngine({ breaker, intents: holdingWrite(3, 2) });
    await test.engine.followBreaker(live);
    await Promise.all([test.engine.followBreaker(live), test.engine.followBreaker(live)]);
    await expect(heldOf(test)).resolves.toStrictEqual([true, 3, "paused"]);
  });

  it("start a look asked while one runs only once that one ended", async () => {
    const { breaker, reads } = slowFirstRead();
    const test = await watchedEngine({ breaker });
    const looks = [test.engine.followBreaker(live), test.engine.followBreaker(live)];
    await test.clock.advance(0);
    const whileRunning = reads.count;
    reads.release();
    await Promise.all(looks);
    expect([whileRunning, reads.count]).toStrictEqual([1, 2]);
  });
});

// A source whose reads never settle while `isHung`, else answer `state`.
function hangingSource(state: BreakerState) {
  const held = { isHung: true };
  const source: BreakerSource = {
    read: async () => (held.isHung ? new Promise<BreakerState>(() => undefined) : state),
  };
  return { source, answer: () => (held.isHung = false) };
}

const unreachable = new BinferenceError({ code: "store.unreachable", message: "No store." });

describe("a look at the breaker that cannot finish", () => {
  it("answers unread after its deadline, keeps the state, and reads again next time", async () => {
    const hanging = hangingSource(pulled(1));
    const test = await watchedEngine({ breaker: hanging.source });
    const look = test.engine.followBreaker(live);
    await test.clock.advance(2_000);
    await expect(look).resolves.toStrictEqual({ outcome: "unread", errorCode: "breaker.timeout" });
    await expect(heldOf(test)).resolves.toStrictEqual([false, undefined, "active"]);
    hanging.answer();
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "pulled" });
  });

  it("reads no install while the source answers the version applied and told", async () => {
    const test = await watchedEngine({ breaker: inTurn([pulled(1)]) });
    await test.engine.followBreaker(live);
    const reads = vi.spyOn(test.stores.install, "read");
    await test.engine.followBreaker(live);
    await test.engine.followBreaker(live);
    expect(reads).not.toHaveBeenCalled();
  });

  it("tells a pull whose told mark failed on the next look, and marks it then", async () => {
    const test = await watchedEngine({ breaker: inTurn([pulled(1)]) });
    vi.spyOn(test.stores.install, "tellBreaker").mockRejectedValueOnce(unreachable);
    await expect(test.engine.followBreaker(live)).rejects.toBeDefined();
    const before = await test.stores.install.read(live);
    await expect(test.engine.followBreaker(live)).resolves.toStrictEqual({ outcome: "kept" });
    const after = await test.stores.install.read(live);
    expect([before.breakerToldVersion, after.breakerToldVersion]).toStrictEqual([undefined, 1]);
  });
});
