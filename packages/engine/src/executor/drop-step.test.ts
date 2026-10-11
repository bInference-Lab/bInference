import type { ReceiptReader } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  type BenchOptions,
  benchChain,
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";
import { restartBench, restartEvents, sendForeign } from "./test-restart.js";

const live = () => ({ signal: new AbortController().signal });
// The rules run at 3 and 6 blocks, and a step every relay refuses is dropped after 9.
const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
const settled = { states: ["reconciled", "failed_onchain"] } as const;
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

// Relays that turn away whatever they get with an answer that says they hold none of it.
function refuseAll(bench: ExecutorBench): void {
  bench.network.script("relay-a", { kind: "refuse", reason: "insufficient_funds" });
  bench.network.script("relay-b", { kind: "refuse", reason: "insufficient_funds" });
}

function acceptAll(bench: ExecutorBench): void {
  bench.network.script("relay-a", { kind: "accept" });
  bench.network.script("relay-b", { kind: "accept" });
}

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

// The keys of the notices the executor sent, oldest first.
function noticeKeysOf(bench: ExecutorBench): readonly string[] {
  return bench.pushes
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => /"key":"([^"]+)"/.exec(JSON.stringify(data))?.[1] ?? "");
}

function rawOf(transaction: TransactionRecord | undefined): string {
  if (transaction === undefined) {
    throw new Error("Expected a stored transaction.");
  }
  return transaction.raw;
}

async function ofIntent(bench: ExecutorBench, intent: Id<"int">) {
  return bench.test.stores.transactions.ofIntent(intent, live());
}

// The intent's first transaction; a test that has none fails.
async function firstOf(bench: ExecutorBench, intent: Id<"int">): Promise<TransactionRecord> {
  const [first] = await ofIntent(bench, intent);
  if (first === undefined) {
    throw new Error("Expected a stored transaction.");
  }
  return first;
}

describe("a stuck step every relay refuses", () => {
  it("is dropped, its nonce goes to the next trade, and the intent fails stuck_dropped", async () => {
    const bench = await startExecutorBench({ limits });
    refuseAll(bench);
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_dropped");
    const states = (await ofIntent(bench, intent)).map(({ state }) => state);
    expect(states).toStrictEqual(["superseded", "dropped"]);
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.stepDropped"]);
    expect(eventsOf(bench)).toContain("executor.step_dropped:");
    acceptAll(bench);
    const next = await tapped(bench);
    await expect(driveUntil(bench, next, settled)).resolves.toBe("reconciled");
    expect((await firstOf(bench, next)).nonce).toBe(0);
  });

  it("is dropped part way after an earlier step landed, and the owner hears so", async () => {
    const bench = await startExecutorBench({ limits });
    const intent = await tapped(bench, tokenSale);
    await flush();
    refuseAll(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_dropped");
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.stepDroppedPartWay"]);
    const states = (await ofIntent(bench, intent)).map(
      ({ step, state }) => `${String(step)}:${state}`,
    );
    expect(states).toStrictEqual(["0:included", "1:superseded", "1:dropped"]);
  });

  it("alarms the owner when a dropped step lands after all", async () => {
    const bench = await startExecutorBench({ limits });
    refuseAll(bench);
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    const [, speedUp] = await ofIntent(bench, intent);
    acceptAll(bench);
    await bench.network.send({ chain: benchChain, raw: rawOf(speedUp) }, live());
    await driveUntil(bench, intent, { states: [], blocks: 2 });
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.stepDropped", "notice.droppedLanded"]);
    expect(eventsOf(bench)).toContain("executor.dropped_landed:");
  });

  it("books a dropped step that landed after all, and leaves its intent failed", async () => {
    const bench = await startExecutorBench({ limits });
    refuseAll(bench);
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    const [, speedUp] = await ofIntent(bench, intent);
    acceptAll(bench);
    await bench.network.send({ chain: benchChain, raw: rawOf(speedUp) }, live());
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench)).toContain("executor.landed_late_booked:");
    expect(await stateOf(bench, intent)).toBe("failed_onchain");
    const executions = await bench.test.positions.executions(
      { isPaper: false, after: 0, limit: 10 },
      live(),
    );
    expect(executions.map(({ intentId }) => intentId)).toStrictEqual([intent]);
    const query = { agentId: testAgent, isPaper: false, fromMs: 0 };
    const [confirmed] = await bench.test.stores.intents.confirmedSince(query, live());
    expect(confirmed?.landedLateAtMs).toBeGreaterThan(0);
  });

  it("is not dropped while a node still holds its bytes in its pool", async () => {
    const bench = await startExecutorBench({ limits });
    bench.network.holdBelow(10n ** 18n);
    const intent = await tapped(bench);
    await flush();
    refuseAll(bench);
    await driveUntil(bench, intent, { states: [], blocks: 25 });
    expect(await reasonOf(bench, intent)).toBeUndefined();
    const states = (await ofIntent(bench, intent)).map(({ state }) => state);
    expect(states).not.toContain("dropped");
  });

  it("is handed over, not dropped, while a relay still takes its bytes", async () => {
    const bench = await startExecutorBench({ limits, network: { feeCapBase: 52_000_000n } });
    bench.network.holdBelow(52_000_000n);
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 18 });
    expect(eventsOf(bench)).toContain("executor.step_stopped:over_fee_cap");
    expect((await transactionsOf(bench)).map(({ state }) => state)).toStrictEqual(["sent"]);
  });
});

describe("recovery of a dropped step", () => {
  it("drops a step every relay still refuses after the stop", async () => {
    const bench = await startExecutorBench({ limits });
    refuseAll(bench);
    const intent = await tapped(bench);
    await flush();
    const restarted = await restartBench(bench, { limits });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_dropped");
    expect(restartEvents(restarted)).toContain("executor.step_dropped:");
    expect(restarted.signed).toStrictEqual([]);
  });

  it("hands a step over when another transaction used its nonce as its drop came due", async () => {
    const bench = await startExecutorBench({ limits });
    refuseAll(bench);
    const intent = await tapped(bench);
    await flush();
    const restarted = await restartBench(bench, { limits });
    acceptAll(bench);
    await sendForeign(bench, 0);
    refuseAll(bench);
    await driveUntil(bench, intent, { states: [], blocks: 14 });
    expect(restartEvents(restarted).at(-1)).toBe("executor.step_stopped:nonce_used");
    expect(await reasonOf(bench, intent)).toBeUndefined();
  });

  it("ends an intent whose step was dropped before the stop, and signs nothing", async () => {
    const bench = await startExecutorBench({ limits });
    bench.network.holdBelow(10n ** 18n);
    const intent = await tapped(bench);
    await flush();
    const first = await firstOf(bench, intent);
    await bench.test.stores.transactions.recordDropped({ id: first.id, atMs: 1 }, live());
    const restarted = await restartBench(bench, { limits });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_dropped");
    expect(restarted.signed).toStrictEqual([]);
  });

  it("records a dropped step whose bytes landed after all, and reconciles it", async () => {
    const bench = await startExecutorBench({ limits });
    bench.network.holdBelow(10n ** 18n);
    const intent = await tapped(bench);
    await flush();
    const first = await firstOf(bench, intent);
    await bench.test.stores.transactions.recordDropped({ id: first.id, atMs: 1 }, live());
    bench.network.holdBelow(0n);
    bench.network.mine();
    const restarted = await restartBench(bench, { limits });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect((await firstOf(bench, intent)).state).toBe("final");
    expect(restarted.signed).toStrictEqual([]);
  });
});

// A swap dropped after every relay refused it; the relays take bytes again once it ended.
async function droppedSwap(options: BenchOptions = {}) {
  const bench = await startExecutorBench({ ...options, limits: { ...limits, ...options.limits } });
  refuseAll(bench);
  const intent = await tapped(bench);
  await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
  acceptAll(bench);
  return { bench, intent };
}

// The speed-up the drop rule ended with, sent again as a relay the rule could not see would.
async function landLate(bench: ExecutorBench, intent: Id<"int">): Promise<TransactionRecord> {
  const [, speedUp] = await ofIntent(bench, intent);
  await bench.network.send({ chain: benchChain, raw: rawOf(speedUp) }, live());
  if (speedUp === undefined) {
    throw new Error("Expected a speed-up.");
  }
  return speedUp;
}

// A node that stops telling what a transaction moved once armed.
function silentTransfers() {
  const state = { isArmed: false };
  return {
    arm: () => {
      state.isArmed = true;
    },
    wrap: (network: FakeNetwork): ReceiptReader => ({
      ...network,
      transfers: async (chain, hash, options) =>
        state.isArmed
          ? Promise.reject(new Error("The node did not answer."))
          : network.transfers(chain, hash, options),
    }),
  };
}

// An intent store that holds a late landing for every intent already.
function linkedAlready(store: IntentStore): IntentStore {
  return { ...store, recordLandedLate: async () => Promise.resolve(err("exists")) };
}

async function executionsOf(bench: ExecutorBench) {
  const query = { isPaper: false, after: 0, limit: 10 };
  return bench.test.positions.executions(query, live());
}

describe("a dropped step that lands late", () => {
  it("books a trade dropped part way once its dropped step lands after the step before it", async () => {
    const bench = await startExecutorBench({ limits });
    const intent = await tapped(bench, tokenSale);
    await flush();
    refuseAll(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    acceptAll(bench);
    const [, , speedUp] = await ofIntent(bench, intent);
    await bench.network.send({ chain: benchChain, raw: rawOf(speedUp) }, live());
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench)).toContain("executor.landed_late_booked:");
    expect((await executionsOf(bench)).map(({ intentId }) => intentId)).toStrictEqual([intent]);
  });

  it("leaves the trade out of the positions when a reorg moves the late block before it is final", async () => {
    const { bench, intent } = await droppedSwap({ network: { finalityDepth: 4n } });
    const landed = await landLate(bench, intent);
    await driveUntil(bench, intent, { states: [], blocks: 2 });
    expect(eventsOf(bench)).toContain("executor.dropped_landed:");
    bench.network.reorg(landed.hash);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench)).toContain("executor.landed_late_unbooked:");
    await expect(executionsOf(bench)).resolves.toStrictEqual([]);
    expect(await stateOf(bench, intent)).toBe("failed_onchain");
  });

  it("stops watching a dropped step after the finality wait, and a later landing raises nothing", async () => {
    const { bench, intent } = await droppedSwap({ limits: { finalAfterBlocks: 3 } });
    await driveUntil(bench, intent, { states: [], blocks: 5 });
    await landLate(bench, intent);
    await driveUntil(bench, intent, { states: [], blocks: 5 });
    expect(eventsOf(bench)).not.toContain("executor.dropped_landed:");
    expect(noticeKeysOf(bench)).toStrictEqual(["notice.stepDropped"]);
  });

  it("leaves the trade out of the positions when the late block is not final within the wait", async () => {
    const options = { network: { finalityDepth: 100n }, limits: { finalAfterBlocks: 3 } };
    const { bench, intent } = await droppedSwap(options);
    await landLate(bench, intent);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench)).toContain("executor.landed_late_unbooked:");
    await expect(executionsOf(bench)).resolves.toStrictEqual([]);
  });

  it("books nothing while no node tells what the trade moved, trying each block up to the settle wait", async () => {
    const silent = silentTransfers();
    const options = { receipts: silent.wrap, limits: { settleAfterBlocks: 3 } };
    const { bench, intent } = await droppedSwap(options);
    silent.arm();
    await landLate(bench, intent);
    await driveUntil(bench, intent, { states: [], blocks: 10 });
    expect(eventsOf(bench)).toContain("executor.dropped_landed:");
    expect(eventsOf(bench)).not.toContain("executor.landed_late_booked:");
    await expect(executionsOf(bench)).resolves.toStrictEqual([]);
  });

  it("still books the trade when its intent has a late landing linked already, and logs it", async () => {
    const { bench, intent } = await droppedSwap({ intents: linkedAlready });
    await landLate(bench, intent);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench)).toEqual(
      expect.arrayContaining([
        "executor.landed_late_linked:exists",
        "executor.landed_late_booked:",
      ]),
    );
  });
});
