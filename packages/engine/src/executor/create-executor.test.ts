import { fakeApprovalData, fakeDraft } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { executorContract } from "../contracts/executor-contract.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import {
  expectOk,
  testAgent,
  testCoin,
  testSwap,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testCall, testCallers } from "../operations/test-engine.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  type BenchOptions,
  blockOf,
  driveUntil,
  eventsOf,
  hashOf,
  tapped,
  transactionsOf,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
// A sale of the token: an exact approval to the fake router, then the swap.
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });
const saleApproval = fakeDraft(testAccount, {
  to: "0x0000000a",
  value: 0n,
  data: fakeApprovalData("0x0000000b", 1_000_000n),
});

// A swap the agent runtime proposed and the auto mode confirmed.
async function automatic(bench: ExecutorBench): Promise<Id<"int">> {
  const handlers = bench.test.engine.handlers;
  const view = expectOk(
    await handlers["intent/propose"](testCall(testSwap(), testCallers.runtime)),
  );
  return view.intent;
}

async function answersOf(bench: ExecutorBench, transaction: TransactionRecord | undefined) {
  const id = transaction?.id ?? ("tx_0190f1c2-3a4b-7c5d-8e6f-000000000000" as Id<"tx">);
  const answers = await bench.test.stores.transactions.sends(id, live());
  return answers.map((answer) => `${answer.relay}:${answer.outcome}`);
}

async function firstStepOf(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const record = await bench.test.stores.intents.get(intent, live());
  const [step] = planDocument.decode(record?.plan ?? null);
  return step?.payload ?? "";
}

async function goPaper(bench: ExecutorBench): Promise<void> {
  const settings = await bench.test.stores.agents.get(testAgent, live());
  const expectedVersion = settings?.agent.version ?? 0;
  const change = { agentId: testAgent, mode: "paper", atMs: 1, expectedVersion } as const;
  expectOk(await bench.test.stores.agents.setMode(change, live()));
}

async function heldTap(options: BenchOptions = {}) {
  const bench = await startExecutorBench({ ...options, hold: true });
  return { bench, intent: await tapped(bench) };
}

async function statesOf(bench: ExecutorBench, intent: Id<"int">, count: number) {
  const history = await bench.test.stores.intents.events(intent, live());
  return history.map((event) => event.toState).slice(-count);
}

describe("the executor", () => {
  it.each(
    executorContract({
      create: async () => {
        const { bench, intent } = await heldTap();
        return { executor: bench.executor, intent };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reconciles a confirmed live intent, its raw bytes stored before the first send", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const [transaction] = await transactionsOf(bench);
    expect(transaction).toMatchObject({ intentId: intent, step: 0, nonce: 0, state: "final" });
    const [firstSend] = bench.sends;
    expect(firstSend?.raw).toBe(transaction?.raw);
    expect(firstSend?.stored).toStrictEqual([transaction?.raw]);
    expect(eventsOf(bench)).toStrictEqual([
      "executor.took:",
      "executor.sent:",
      "executor.finalized:",
      "executor.reconciled:",
    ]);
    const entries = bench.pushes.filter((push) => push.kind === "ledger/appended");
    expect(entries.map((push) => JSON.stringify(push.data))).toStrictEqual([
      expect.stringContaining('"kind":"executing"'),
      expect.stringContaining('"kind":"sent"'),
      expect.stringContaining('"kind":"reconciled"'),
    ]);
    expect(await statesOf(bench, intent, 5)).toStrictEqual([
      "confirmed",
      "executing",
      "included",
      "finalized",
      "reconciled",
    ]);
  });

  it("sends the same stored bytes again after a failed send, and never signs again", async () => {
    const bench = await startExecutorBench();
    bench.network.script("relay-a", { kind: "refuse", reason: "underpriced" });
    bench.network.script("relay-b", { kind: "unreachable" });
    const intent = await tapped(bench);
    await flush();
    const [unsent] = await transactionsOf(bench);
    expect(unsent?.state).toBe("signed");
    bench.network.script("relay-b", { kind: "accept" });
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(1);
    expect(bench.sends.map(({ raw }) => raw)).toStrictEqual([unsent?.raw, unsent?.raw]);
    expect(await answersOf(bench, unsent)).toStrictEqual([
      "relay-a:refused",
      "relay-b:unreachable",
      "relay-a:refused",
      "relay-b:accepted",
    ]);
  });

  it("records each relay's answer when one times out, and sends nothing again", async () => {
    const bench = await startExecutorBench();
    bench.network.script("relay-a", { kind: "hang" });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const [transaction] = await transactionsOf(bench);
    expect(await answersOf(bench, transaction)).toStrictEqual([
      "relay-a:timed_out",
      "relay-b:accepted",
    ]);
    expect(bench.network.sends()).toBe(1);
  });

  it("runs a plan's steps one after another, at consecutive nonces", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench, tokenSale);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const transactions = await transactionsOf(bench);
    expect(transactions.map(({ step, nonce, state }) => [step, nonce, state])).toStrictEqual([
      [0, 0, "final"],
      [1, 1, "final"],
    ]);
    const kinds = bench.signed.map((request) => request.step.action.kind);
    expect(kinds).toStrictEqual(["approve", "call"]);
    expect(blockOf(transactions[1])).toBeGreaterThan(blockOf(transactions[0]));
  });

  it("never sends a later step once a step reverts, and ends failed_onchain", async () => {
    const bench = await startExecutorBench({ network: { reverting: [saleApproval.payload] } });
    const intent = await tapped(bench, tokenSale);
    const goal = { states: ["failed_onchain"] } as const;
    await expect(driveUntil(bench, intent, goal)).resolves.toBe("failed_onchain");
    const transactions = await transactionsOf(bench);
    expect(transactions.map(({ step, state }) => [step, state])).toStrictEqual([[0, "reverted"]]);
    expect(bench.signed).toHaveLength(1);
    const record = await bench.test.stores.intents.get(intent, live());
    expect(record?.reason).toBe("reverted");
  });

  it("signs a tapped intent with the owner's confirmation and the venue's contracts", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await flush();
    const confirmation = await bench.test.stores.intents.confirmation(intent, live());
    const router = "fake:1:0x0000000b";
    expect(bench.signed[0]).toMatchObject({
      wallet: testWallet,
      intent,
      step: { index: 0, chain: "fake:1", action: { kind: "call", nativeValue: 1_000_000n } },
      authorization: { kind: "confirmation", id: confirmation?.id, intent },
      termsHash: confirmation?.termsHash,
      allowed: { contracts: [router], spenders: [router], recipients: [] },
    });
  });

  it("signs an auto intent with its grant and the mode as it stands", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" } });
    const intent = await automatic(bench);
    await flush();
    const cap = 1_000_000_000n;
    expect(bench.signed[0]?.authorization).toMatchObject({
      kind: "approvalMode",
      grant: { approvalMode: "auto", agent: testAgent, intent, networkFeeCapNativeBase: cap },
      current: { agent: testAgent, mode: "auto" },
    });
  });
});

describe("the executor's refusals", () => {
  it("leaves an intent confirmed and signs nothing when its card expired first", async () => {
    const { bench, intent } = await heldTap();
    await bench.test.clock.advance(61_000);
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.move_refused:expired"]);
    expect(bench.signed).toStrictEqual([]);
  });

  it("leaves an intent confirmed when its agent went back to paper", async () => {
    const { bench, intent } = await heldTap();
    await goPaper(bench);
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.move_refused:agent_not_live"]);
  });

  it("leaves an intent confirmed when its first step would fail now", async () => {
    const { bench, intent } = await heldTap();
    bench.network.failing(await firstStepOf(bench, intent));
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.not_taken:would_fail"]);
  });

  it("leaves an auto intent confirmed while the fee per gas is above the cap", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" }, hold: true });
    const intent = await automatic(bench);
    bench.network.setFeePerGas(2_000_000_000n);
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.not_taken:over_fee_cap"]);
    expect(bench.signed).toStrictEqual([]);
  });

  it("cancels an intent whose first step custody refuses, with nothing stored or sent", async () => {
    const { bench, intent } = await heldTap();
    bench.test.custody.removeFrom(testWallet);
    await bench.release();
    await flush();
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(eventsOf(bench)).toStrictEqual([
      "executor.took:",
      "executor.step_stopped:refused",
      "executor.step_unsent:cancelled",
    ]);
    expect(await transactionsOf(bench)).toStrictEqual([]);
    expect(bench.network.sends()).toBe(0);
  });

  it("hands a step over as stuck when no block holds it, signed once", async () => {
    const bench = await startExecutorBench({ limits: { stuckAfterBlocks: 3 } });
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 6 });
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:stuck");
    expect([bench.signed.length, bench.network.sends()]).toStrictEqual([1, 3]);
  });

  it("takes nothing it cannot run, and nothing once closed", async () => {
    const bench = await startExecutorBench();
    const handlers = bench.test.engine.handlers;
    const proposed = expectOk(await handlers["intent/propose"](testCall(testSwap())));
    await bench.executor.take(proposed.intent, live());
    expect(eventsOf(bench)).toStrictEqual(["executor.not_taken:not_confirmed"]);
    await bench.executor.close();
    await expect(bench.executor.take(proposed.intent, live())).rejects.toMatchObject({
      code: "engine.executor_closed",
    });
  });
});

describe("the executor's watch", () => {
  it("follows a reorg back to executing and on to reconciled, with the same bytes", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["included"] });
    const [included] = await transactionsOf(bench);
    bench.network.mine(2);
    bench.network.reorg(hashOf(included));
    await bench.test.clock.advance(1_000);
    await flush();
    expect(await stateOf(bench, intent)).toBe("executing");
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(eventsOf(bench)).toContain("executor.reorg_seen:");
    expect(bench.signed).toHaveLength(1);
    expect(await statesOf(bench, intent, 6)).toStrictEqual([
      "executing",
      "included",
      "executing",
      "included",
      "finalized",
      "reconciled",
    ]);
  });

  it("stops watching when the executor closes", async () => {
    const bench = await startExecutorBench();
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    const intent = await tapped(bench);
    await flush();
    await bench.executor.close();
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.stopping");
  });
});
