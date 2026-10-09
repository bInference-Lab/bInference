import type { ReceiptReader, Signer } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { testCoin, testSwap, testToken } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import type { EnginePush } from "../pushes/engine-push.js";
import {
  type BenchOptions,
  benchChain,
  driveUntil,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";
import { restartBench, restartEvents, sendForeign } from "./test-restart.js";

const live = () => ({ signal: new AbortController().signal });
// A sale of the token: an exact approval to the fake router, then the swap.
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });
const settled = { states: ["reconciled", "failed_onchain"] } as const;

// Relays that take nothing: what is signed stays `signed`.
async function signedOnly(options: BenchOptions = {}) {
  const bench = await startExecutorBench(options);
  bench.network.script("relay-a", { kind: "unreachable" });
  bench.network.script("relay-b", { kind: "unreachable" });
  const intent = await tapped(bench);
  await flush();
  bench.network.script("relay-a", { kind: "accept" });
  bench.network.script("relay-b", { kind: "accept" });
  return { bench, intent };
}

// The stored bytes of the intent's one step reach a block, as a relay that took them before the
// stop would leave them.
async function minedBeforeRestart(bench: ExecutorBench): Promise<void> {
  const [stored] = await transactionsOf(bench);
  await bench.network.send({ chain: benchChain, raw: stored?.raw ?? "" }, live());
  bench.network.mine();
}

// The network's reads, with its receipt read replaced.
function withReceipts(network: FakeNetwork, receipt: ReceiptReader["receipt"]): ReceiptReader {
  return {
    head: async (chain, options) => network.head(chain, options),
    transfers: async (chain, hash, options) => network.transfers(chain, hash, options),
    nonceAt: async (account, block, options) => network.nonceAt(account, block, options),
    nativeReceived: async (account, block, options) =>
      network.nativeReceived(account, block, options),
    receipt,
  };
}

// A node behind its peers: its first receipt reads miss a block the count already shows.
function lagging(misses: number): (network: FakeNetwork) => ReceiptReader {
  return (network) => {
    let left = misses;
    return withReceipts(network, async (chain, hash, options) => {
      if (left > 0) {
        left -= 1;
        return Promise.resolve(undefined);
      }
      return network.receipt(chain, hash, options);
    });
  };
}

// A node whose every receipt shows a revert.
function reverting(network: FakeNetwork): ReceiptReader {
  return withReceipts(network, async (chain, hash, options) => {
    const receipt = await network.receipt(chain, hash, options);
    return receipt === undefined ? undefined : { ...receipt, status: "reverted" };
  });
}

// An intent store that stops the engine as it would write the move to `reconciled`.
function stoppingBeforeReconciled(store: IntentStore): IntentStore {
  return {
    ...store,
    async transition(change, options) {
      if (change.state === "reconciled") {
        throw new Error("The engine stopped.");
      }
      return store.transition(change, options);
    },
  };
}

// Custody that never answers the step at `index`, until the run stops.
function hangingAt(index: number): (custody: Signer) => Signer {
  return (custody) => ({
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    async signTransaction(request, options) {
      if (request.step.index !== index) {
        return custody.signTransaction(request, options);
      }
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(options.signal.reason);
        });
      });
    },
  });
}

// The keys of the notices among pushes, oldest first.
function noticeKeys(pushes: readonly EnginePush[]): readonly string[] {
  return pushes
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => JSON.stringify(data))
    .map((data) => /"key":"([^"]+)"/.exec(data)?.[1] ?? "");
}

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

describe("recovery after a restart", () => {
  it("sends a signed step whose nonce is still free again, with the same bytes", async () => {
    const { bench, intent } = await signedOnly();
    const [stored] = await transactionsOf(bench);
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(restarted.recovered).toBe(1);
    expect(restarted.signed).toHaveLength(0);
    expect(restarted.sends.map(({ raw }) => raw)).toStrictEqual([stored?.raw]);
    const [after] = await transactionsOf(bench);
    expect(after).toMatchObject({ id: stored?.id, raw: stored?.raw, state: "final" });
  });

  it("goes on from the block that holds a signed step a relay took before the stop", async () => {
    const { bench, intent } = await signedOnly();
    await minedBeforeRestart(bench);
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(restarted.signed).toHaveLength(0);
    expect(restarted.sends).toHaveLength(0);
  });

  it("sends a sent step no block holds again, with the same bytes", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await flush();
    const [sent] = await transactionsOf(bench);
    expect(sent?.state).toBe("sent");
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(restarted.signed).toHaveLength(0);
    expect(restarted.sends.map(({ raw }) => raw)).toStrictEqual([sent?.raw]);
  });

  it("ends failed_onchain with nonce_taken and an alarm once another transaction's nonce is final", async () => {
    const { bench, intent } = await signedOnly();
    await sendForeign(bench, 0);
    bench.network.mine();
    const restarted = await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("unknown_after_send");
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("nonce_taken");
    expect(restarted.signed).toHaveLength(0);
    expect(restarted.sends).toHaveLength(0);
    const notices = restarted.pushes.filter(({ kind }) => kind === "notice/new");
    expect(notices.map(({ data }) => data)).toMatchObject([
      { key: "notice.unknownTx", intent, values: { wallet: "0x0000000c", nonce: "0" } },
    ]);
    expect(restartEvents(restarted)).toContain("executor.nonce_taken:");
  });

  it("goes back to executing when the unknown step turns out to be its own", async () => {
    const { bench, intent } = await signedOnly();
    await minedBeforeRestart(bench);
    const restarted = await restartBench(bench, { receipts: lagging(1) });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    const states = (await bench.test.stores.intents.events(intent, live())).map(
      ({ toState }) => toState,
    );
    expect(states).toContain("unknown_after_send");
    expect(states.slice(-5)).toStrictEqual([
      "unknown_after_send",
      "executing",
      "included",
      "finalized",
      "reconciled",
    ]);
    expect(restarted.signed).toHaveLength(0);
  });

  it("reconciles an intent the stop left in unknown_after_send", async () => {
    const { bench, intent } = await signedOnly();
    await minedBeforeRestart(bench);
    const first = await restartBench(bench, {
      receipts: lagging(2),
      limits: { finalAfterBlocks: 0 },
    });
    expect(await stateOf(bench, intent)).toBe("unknown_after_send");
    expect(restartEvents(first)).toContain("executor.unknown_late:");
    const second = await restartBench({ ...bench, executor: first.executor }, { idSeed: 101 });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect([...first.signed, ...second.signed]).toHaveLength(0);
  });

  it("watches an included step to finality and reconciles it", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: ["included"] });
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(restarted.signed).toHaveLength(0);
  });

  it("reconciles a finalized intent once, its trade recorded once", async () => {
    const bench = await startExecutorBench({ limits: { settleAfterBlocks: 0 } });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["finalized"] })).resolves.toBe("finalized");
    const restarted = await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("reconciled");
    const query = { isPaper: false, after: 0, limit: 10 };
    const executions = await bench.test.positions.executions(query, live());
    expect(executions.map(({ intentId }) => intentId)).toStrictEqual([intent]);
    expect(restarted.signed).toHaveLength(0);
  });

  it("reconciles a trade after a restart once a node can say what it received again", async () => {
    const bench = await startExecutorBench();
    const intent = await tapped(bench, tokenSale);
    await driveUntil(bench, intent, { states: ["included"] });
    bench.network.forgetStateBelow(1_000n);
    await driveUntil(bench, intent, { states: ["reconciled"], blocks: 6 });
    expect(await stateOf(bench, intent)).toBe("finalized");
    bench.network.forgetStateBelow(0n);
    const restarted = await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("reconciled");
    const query = { isPaper: false, after: 0, limit: 10 };
    const [execution] = await bench.test.positions.executions(query, live());
    expect(execution?.bought).toStrictEqual({ asset: testCoin, base: 2_000_000n });
    expect(restarted.signed).toHaveLength(0);
  });

  it("records a trade once when the stop fell between its record and the move", async () => {
    const bench = await startExecutorBench({ intents: stoppingBeforeReconciled });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, { states: ["finalized"] })).resolves.toBe("finalized");
    await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("reconciled");
    const query = { isPaper: false, after: 0, limit: 10 };
    expect(await bench.test.positions.executions(query, live())).toHaveLength(1);
  });

  it("ends failed_onchain when the block that holds the step shows a revert", async () => {
    const { bench, intent } = await signedOnly();
    await minedBeforeRestart(bench);
    const restarted = await restartBench(bench, { receipts: reverting });
    await expect(stateOf(bench, intent)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("reverted");
    expect(restarted.signed).toHaveLength(0);
  });

  it("cancels an intent whose first step the stop left unsigned, signing nothing", async () => {
    const bench = await startExecutorBench({ custody: hangingAt(0) });
    const intent = await tapped(bench);
    await flush();
    expect(await stateOf(bench, intent)).toBe("executing");
    const restarted = await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(await transactionsOf(bench)).toStrictEqual([]);
    expect(restarted.signed).toHaveLength(0);
    expect(noticeKeys(restarted.pushes)).toStrictEqual(["notice.notSigned"]);
  });

  it("fails an intent with step_unsent when a later step was never signed after one landed", async () => {
    const bench = await startExecutorBench({ custody: hangingAt(1) });
    const intent = await tapped(bench, tokenSale);
    await driveUntil(bench, intent, { states: ["reconciled"], blocks: 3 });
    const [approval] = await transactionsOf(bench);
    expect(approval?.state).toBe("included");
    const restarted = await restartBench(bench);
    expect(await stateOf(bench, intent)).toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("step_unsent");
    expect(restarted.signed).toHaveLength(0);
    expect(noticeKeys(restarted.pushes)).toStrictEqual(["notice.stepUnsent"]);
  });

  it("stops without a signature when the chain cannot be read", async () => {
    const { bench, intent } = await signedOnly();
    bench.network.failReads(1_000);
    const restarted = await restartBench(bench, { limits: { stuckAfterBlocks: 1 } });
    await driveUntil(bench, intent, { states: ["reconciled"], blocks: 5 });
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(restarted.signed).toHaveLength(0);
    expect(restartEvents(restarted)).toContain("executor.step_stopped:chain_unread");
  });

  it("leaves an intent it cannot plan as it is, and recovers nothing once closed", async () => {
    const { bench, intent } = await signedOnly();
    const restarted = await restartBench(bench, { withoutRelays: true });
    expect(restarted.recovered).toBe(0);
    expect(restartEvents(restarted)).toContain("executor.not_recovered:no_relays");
    expect(await stateOf(bench, intent)).toBe("executing");
    await restarted.executor.close();
    await expect(restarted.executor.recover(live())).rejects.toMatchObject({
      code: "engine.executor_closed",
    });
  });
});
