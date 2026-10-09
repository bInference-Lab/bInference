import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testSwap, testToken } from "../intents/test-intents.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  startExecutorBench,
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

  it("is handed over, not dropped, while a relay still takes its bytes", async () => {
    const bench = await startExecutorBench({ limits, network: { feeCapBase: 52_000_000n } });
    bench.network.holdBelow(52_000_000n);
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 18 });
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:over_fee_cap");
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
