import type { Id } from "@binference/core";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { IntentState } from "../intents/intent-state.js";
import type { ExecutionRecord } from "../positions/execution-record.js";
import { inBlockStates } from "../wallet-queue/lowest-free-nonce.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  benchChain,
  type ExecutorBench,
  flush,
  hashOf,
  startExecutorBench,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });

/** What happens to a stuck swap, block by block: the chain and the relays a run scripts. */
interface StuckScript {
  /** The block from which the swap would fail: a passed deadline or a moved price. */
  readonly failsAt?: number;
  /** The block from which the relays refuse whatever takes a pooled nonce. */
  readonly refusesFrom?: number;
  /** The block at which relays drop the first transaction. */
  readonly dropsAt?: number;
  /** The block from which every relay drops the swap's bytes and turns them away. */
  readonly rejectsFrom?: number;
  /** The block from which the chain takes every fee again. */
  readonly releasesAt: number;
}

const blocks = 24;
const block = fc.nat({ max: blocks - 1 });
const scripts = fc.record(
  {
    failsAt: block,
    refusesFrom: block,
    dropsAt: block,
    rejectsFrom: block,
    releasesAt: block,
  },
  { requiredKeys: ["releasesAt"] },
);

async function stepPayload(bench: ExecutorBench, intent: Id<"int">) {
  const record = await bench.test.stores.intents.get(intent, live());
  const [step] = planDocument.decode(record?.plan ?? null);
  return step?.payload ?? "";
}

// Applies the script's events of one block, then mines it.
async function playBlock(
  bench: ExecutorBench,
  played: { readonly script: StuckScript; readonly at: number; readonly payload: string },
): Promise<void> {
  const { script, at, payload } = played;
  const { network } = bench;
  if (script.failsAt === at) {
    network.failing(payload);
  }
  if (script.refusesFrom === at) {
    network.script("relay-a", { kind: "refuse", reason: "replacement_underpriced" });
    network.script("relay-b", { kind: "refuse", reason: "replacement_underpriced" });
  }
  if (script.dropsAt === at) {
    const [first] = await transactionsOf(bench);
    network.drop(hashOf(first));
  }
  if (script.rejectsFrom === at) {
    const stored = await transactionsOf(bench);
    stored.forEach(({ hash }) => {
      network.drop(hash);
    });
    network.script("relay-a", { kind: "refuse", reason: "insufficient_funds" });
    network.script("relay-b", { kind: "refuse", reason: "insufficient_funds" });
  }
  if (script.releasesAt === at) {
    network.holdBelow(0n);
  }
  network.mine();
  await bench.test.clock.advance(1_000);
  await flush();
}

/** How a run ended: the intent's state, its transactions, the fills and the chain's blocks. */
interface Played {
  readonly state: IntentState;
  readonly reason?: string;
  /** How many of the intent's transactions a block on the chain holds. */
  readonly onChain: number;
  readonly transactions: readonly TransactionRecord[];
  readonly executions: readonly ExecutionRecord[];
}

// Plays the script's blocks in turn, each after the one before it, as the chain does.
async function playFrom(
  bench: ExecutorBench,
  played: { readonly script: StuckScript; readonly at: number; readonly payload: string },
): Promise<void> {
  if (played.at < blocks) {
    await playBlock(bench, played);
    await playFrom(bench, { ...played, at: played.at + 1 });
  }
}

async function play(script: StuckScript): Promise<Played> {
  const bench = await startExecutorBench({
    limits: { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 },
  });
  bench.network.holdBelow(10n ** 18n);
  const intent = await tapped(bench);
  await flush();
  const payload = await stepPayload(bench, intent);
  await playFrom(bench, { script, at: 0, payload });
  const [record, transactions, executions] = await Promise.all([
    bench.test.stores.intents.get(intent, live()),
    transactionsOf(bench),
    bench.test.positions.executions({ isPaper: false, after: 0, limit: 10 }, live()),
  ]);
  const receipts = await Promise.all(
    transactions.map(async ({ hash }) => bench.network.receipt(benchChain, hash, live())),
  );
  const onChain = receipts.filter((receipt) => receipt !== undefined).length;
  const state = record?.state ?? "proposed";
  return {
    state,
    transactions,
    executions,
    onChain,
    ...(record?.reason === undefined ? {} : { reason: record.reason }),
  };
}

// What must hold once a run ends: every transaction at the step's nonce, at most one of them in
// a block, a fill exactly when the intent reconciled and only from the one that landed, a landed
// cancel exactly when the intent failed with one, and no block holding a dropped step.
function invariantsOf(played: Played) {
  const { state, transactions, executions } = played;
  const landed = transactions.filter(({ state: at }) => inBlockStates.includes(at));
  const isFilled = state === "reconciled";
  const fills = executions.map(({ txHash }) => txHash);
  return {
    isOneNonce: transactions.every(({ nonce }) => nonce === 0),
    isOneLanded: landed.length <= 1,
    isFilledByLanded: isFilled
      ? fills.length === 1 && fills[0] === landed[0]?.hash
      : fills.length === 0,
    isDropUnlanded: played.reason !== "stuck_dropped" || played.onChain === 0,
    isOneOnChain: played.onChain <= 1,
    isCancelTheEnd: landed.every(
      ({ replaces }) => (replaces?.kind === "cancel") === (state === "failed_onchain"),
    ),
  };
}

describe("a stuck swap's replacements", () => {
  it("never fill twice: one transaction of its nonce lands, and a fill only from a step", async () => {
    await fc.assert(
      fc.asyncProperty(scripts, async (script) => {
        expect(invariantsOf(await play(script))).toStrictEqual({
          isOneNonce: true,
          isOneLanded: true,
          isFilledByLanded: true,
          isDropUnlanded: true,
          isOneOnChain: true,
          isCancelTheEnd: true,
        });
      }),
      { numRuns: 60 },
    );
  });
});
