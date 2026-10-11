import type { ReceiptReader } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { IntentStore, TransactionStore } from "../ports.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  hashOf,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
// Above every fee per gas the bench prepares with: nothing is mined while the network holds it.
const holdAll = 10n ** 18n;

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

// The intent's step leaves its block in a reorg and waits unmined, as a base fee that rose would
// leave it, until its block would have been final.
async function reorgedUnmined(bench: ExecutorBench, intent: Id<"int">): Promise<void> {
  await expect(driveUntil(bench, intent, { states: ["included"] })).resolves.toBe("included");
  const [included] = await transactionsOf(bench);
  bench.network.holdBelow(holdAll);
  bench.network.reorg(hashOf(included));
}

/** A part's fault, which a test arms once the intent is where it wants the fault. */
interface Fault<In, Out = In> {
  readonly wrap: (inner: In) => Out;
  readonly arm: () => void;
}

// A node that fails to answer `count` receipt reads once armed.
function failingReceipts(count: number): Fault<FakeNetwork, ReceiptReader> {
  const state = { isArmed: false, left: count };
  return {
    arm: () => {
      state.isArmed = true;
    },
    wrap: (network) => ({
      ...network,
      receipt: async (chain, hash, options) => {
        if (state.isArmed && state.left > 0) {
          state.left -= 1;
          throw new Error("The node did not answer.");
        }
        return network.receipt(chain, hash, options);
      },
    }),
  };
}

// A store that refuses to record a receipt once armed, as one whose row moved on would.
function refusingReceipts(): Fault<TransactionStore> {
  const state = { isArmed: false };
  return {
    arm: () => {
      state.isArmed = true;
    },
    wrap: (store) => ({
      ...store,
      recordReceipt: async (mark, options) =>
        state.isArmed ? err("wrong_state") : store.recordReceipt(mark, options),
    }),
  };
}

// An intent store that loses every move back to `executing` to another writer once armed.
function racedBack(): Fault<IntentStore> {
  const state = { isArmed: false };
  return {
    arm: () => {
      state.isArmed = true;
    },
    wrap: (store) => ({
      ...store,
      transition: async (change, options) =>
        state.isArmed && change.state === "executing"
          ? err("stale")
          : store.transition(change, options),
    }),
  };
}

describe("the finality watch after a reorg", () => {
  it("moves the intent back to executing and sends the same bytes again until a block holds them", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await reorgedUnmined(bench, intent);
    await expect(driveUntil(bench, intent, { states: ["executing"] })).resolves.toBe("executing");
    expect(eventsOf(bench)).toContain("executor.reorg_seen:");
    bench.network.holdBelow(0n);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(1);
    const [step] = await transactionsOf(bench);
    expect(step?.state).toBe("final");
  });

  it("drops a step every relay turns away after a reorg took it, and fails the intent stuck_dropped", async () => {
    const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
    const bench = await startExecutorBench({ limits });
    const intent = await tapped(bench);
    await reorgedUnmined(bench, intent);
    const [step] = await transactionsOf(bench);
    bench.network.drop(hashOf(step));
    bench.network.script("relay-a", { kind: "refuse", reason: "insufficient_funds" });
    bench.network.script("relay-b", { kind: "refuse", reason: "insufficient_funds" });
    const settled = { states: ["reconciled", "failed_onchain"] } as const;
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_dropped");
    expect(eventsOf(bench)).toEqual(
      expect.arrayContaining(["executor.reorg_seen:", "executor.step_dropped:"]),
    );
  });

  it("stops when another writer moved the intent before the reorg's move back", async () => {
    const raced = racedBack();
    const bench = await startExecutorBench({ intents: raced.wrap });
    const intent = await tapped(bench);
    await reorgedUnmined(bench, intent);
    raced.arm();
    await driveUntil(bench, intent, { states: [], blocks: 6 });
    await expect(stateOf(bench, intent)).resolves.toBe("included");
    expect(eventsOf(bench)).toContain("executor.move_stale:reorg_seen");
    expect(eventsOf(bench)).not.toContain("executor.reorg_seen:");
  });

  it("fails the run when the store refuses the receipt of a step a reorg moved to another block", async () => {
    const refusing = refusingReceipts();
    const bench = await startExecutorBench({ transactions: refusing.wrap });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["included"] })).resolves.toBe("included");
    refusing.arm();
    const [included] = await transactionsOf(bench);
    bench.network.reorg(hashOf(included));
    bench.network.mine(3);
    await driveUntil(bench, intent, { states: [], blocks: 4 });
    await expect(stateOf(bench, intent)).resolves.toBe("included");
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.transaction_moved");
  });
});

describe("the finality watch on a failing node", () => {
  it("waits a block when the head cannot be read, and still finalizes", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["included"] })).resolves.toBe("included");
    bench.network.failReads(3);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(eventsOf(bench)).toContain("executor.read_failed:chain.rpc_down");
  });

  it("reads a step's receipt again on the next block when the node fails to answer it", async () => {
    const failing = failingReceipts(2);
    const bench = await startExecutorBench({ receipts: failing.wrap });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["included"] })).resolves.toBe("included");
    failing.arm();
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(
      eventsOf(bench).filter((event) => event === "executor.read_failed:unexpected"),
    ).toHaveLength(2);
  });
});
