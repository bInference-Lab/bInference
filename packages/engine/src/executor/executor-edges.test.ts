import { accountRefSchema, type Signer } from "@binference/chain";
import { signFake } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { planDocument } from "../intents/intent-documents.schema.js";
import { expectOk, testCoin, testSwap, testToken } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import type { IntentStore, TransactionStore } from "../ports.js";
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
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

// The payload of a token sale's second step, the swap after its approval.
async function swapPayload(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const record = await bench.test.stores.intents.get(intent, live());
  const [, swap] = planDocument.decode(record?.plan ?? null);
  return swap?.payload ?? "";
}

// Custody that answers another account for every wallet.
function strangerAccount(custody: Signer): Signer {
  const stranger = accountRefSchema.parse("fake:1:0x000000ff");
  return {
    account: async () => Promise.resolve({ ok: true, value: stranger }),
    signTransaction: async (request, options) => custody.signTransaction(request, options),
  };
}

// Custody that signs as another address than the transaction's sender.
function wrongSigner(custody: Signer): Signer {
  return {
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async (request) =>
      Promise.resolve({ ok: true, value: signFake(request.tx, "0x000000ff") }),
  };
}

function refusing(
  method: "saveSigned" | "recordSend" | "recordReceipt" | "recordFinal",
): (store: TransactionStore) => TransactionStore {
  return (store: TransactionStore): TransactionStore => ({
    ...store,
    [method]: async () =>
      Promise.resolve(err(method === "saveSigned" ? "nonce_taken" : "wrong_state")),
  });
}

// An intent store that loses the race of the move to `executing` to another writer.
function racedToExecuting(store: IntentStore): IntentStore {
  return {
    ...store,
    transition: async (change, options) =>
      change.state === "executing" ? err("stale") : store.transition(change, options),
  };
}

describe("the executor on what it cannot run", () => {
  it.each<[string, BenchOptions, string]>([
    ["a chain without relays", { withoutRelays: true }, "no_relays"],
    [
      "a wallet custody holds no account of",
      {
        custody: () => ({
          account: async () => Promise.resolve(err("unknown_wallet")),
          signTransaction: async () => Promise.resolve(err("refused")),
        }),
      },
      "unknown_wallet",
    ],
    [
      "steps from an account that is not the wallet's",
      { custody: strangerAccount },
      "other_sender",
    ],
  ])("leaves an intent confirmed on %s", async (_, options, problem) => {
    const bench = await startExecutorBench(options);
    const intent = await tapped(bench);
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual([`executor.not_taken:${problem}`]);
  });

  it.each<[string, BenchOptions, string]>([
    ["bytes another signer signed", { custody: wrongSigner }, "bad_signature"],
    ["a store that finds the nonce taken", { transactions: refusing("saveSigned") }, "nonce_taken"],
  ])("stops a step on %s, with nothing sent", async (_, options, problem) => {
    const bench = await startExecutorBench(options);
    const intent = await tapped(bench);
    await flush();
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe(`executor.step_stopped:${problem}`);
    expect(bench.network.sends()).toBe(0);
  });

  it.each<[string, BenchOptions]>([
    ["a send", { transactions: refusing("recordSend") }],
    ["a receipt", { transactions: refusing("recordReceipt") }],
    ["a final block", { transactions: refusing("recordFinal") }],
  ])("fails a run whose store refuses to record %s", async (_, options) => {
    const bench = await startExecutorBench(options);
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 5 });
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.transaction_moved");
  });

  it("stops when another writer moved the intent first", async () => {
    const bench = await startExecutorBench({ intents: racedToExecuting });
    const intent = await tapped(bench);
    await flush();
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.move_stale:queue_took"]);
    expect(bench.signed).toStrictEqual([]);
  });
});

describe("the executor on a later step", () => {
  it("stops a later step that would fail now, after the step before it landed", async () => {
    const bench = await startExecutorBench({ hold: true });
    const intent = await tapped(bench, tokenSale);
    bench.network.failing(await swapPayload(bench, intent));
    await bench.release();
    await driveUntil(bench, intent, { states: [], blocks: 3 });
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:would_fail");
    expect((await transactionsOf(bench)).map(({ step }) => step)).toStrictEqual([0]);
  });

  it("stops an auto intent's later step once the fee per gas passes the cap", async () => {
    const bench = await startExecutorBench({ agent: { approvalMode: "auto" } });
    const handlers = bench.test.engine.handlers;
    const view = expectOk(
      await handlers["intent/propose"](testCall(tokenSale, testCallers.runtime)),
    );
    await flush();
    bench.network.setFeePerGas(2_000_000_000n);
    await driveUntil(bench, view.intent, { states: [], blocks: 3 });
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:over_fee_cap");
    expect(bench.signed).toHaveLength(1);
  });
});

describe("the executor's watch on a failing node", () => {
  it("reads again on the next block when a read fails, and still finalizes", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    bench.network.failReads(3);
    await expect(driveUntil(bench, intent, { states: ["finalized"] })).resolves.toBe("finalized");
    expect(eventsOf(bench)).toContain("executor.read_failed:chain.rpc_down");
  });

  it("hands a step over as stuck when the head cannot be read for long", async () => {
    const bench = await startExecutorBench({ limits: { stuckAfterBlocks: 2 } });
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    bench.network.failReads(1_000);
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:stuck");
  });

  it("follows a step a reorg moved to another block before it was final", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["included"] });
    const [included] = await transactionsOf(bench);
    bench.network.reorg(hashOf(included));
    bench.network.mine(3);
    await expect(driveUntil(bench, intent, { states: ["finalized"] })).resolves.toBe("finalized");
    const [final] = await transactionsOf(bench);
    expect(blockOf(final)).toBeGreaterThan(blockOf(included));
    expect(eventsOf(bench)).not.toContain("executor.reorg_seen:");
  });

  it("hands an intent over, still included, when finality takes too long", async () => {
    const bench = await startExecutorBench({
      network: { finalityDepth: 100n },
      limits: { finalAfterBlocks: 2 },
    });
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 6 });
    expect(await stateOf(bench, intent)).toBe("included");
    expect(eventsOf(bench).at(-1)).toBe("executor.final_late:");
  });
});
