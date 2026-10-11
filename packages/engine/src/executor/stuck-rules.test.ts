import type { ReceiptReader, Signer, TxPreparer } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import { BinferenceError, err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { planDocument } from "../intents/intent-documents.schema.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  benchChain,
  type BenchOptions,
  blockOf,
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  hashOf,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";
import { restartBench, restartEvents } from "./test-restart.js";

const live = () => ({ signal: new AbortController().signal });
// The rules run at 3 and 6 blocks, a step every relay refuses is dropped after 9, and the network
// holds back a fee below 52 000 000.
const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
const held = 52_000_000n;
const settled = { states: ["reconciled", "failed_onchain"] } as const;

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live()))?.reason;
}

// A stored transaction's signed bytes; a test that has none fails.
function rawOf(transaction: TransactionRecord | undefined): string {
  if (transaction === undefined) {
    throw new Error("Expected a stored transaction.");
  }
  return transaction.raw;
}

// The ledger's `sent` entries: one for each transaction a relay first took.
async function sentEntriesOf(bench: ExecutorBench): Promise<number> {
  const entries = await bench.test.stores.ledger.list({ after: 0, limit: 100 }, live());
  return entries.filter(({ kind }) => kind === "sent").length;
}

async function executionsOf(bench: ExecutorBench) {
  return bench.test.positions.executions({ isPaper: false, after: 0, limit: 10 }, live());
}

// The payload of the intent's one step, which a test makes fail now.
async function stepPayload(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const record = await bench.test.stores.intents.get(intent, live());
  const [step] = planDocument.decode(record?.plan ?? null);
  return step?.payload ?? "";
}

// A tapped swap whose first transaction is sent and held out of every block.
async function stuckSwap(options: BenchOptions = {}) {
  const bench = await startExecutorBench({ limits, ...options });
  bench.network.holdBelow(held);
  const intent = await tapped(bench);
  await flush();
  return { bench, intent };
}

// Custody that refuses every speed-up and cancel.
function refusingReplacements(custody: Signer): Signer {
  return {
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async (request, options) =>
      request.step.replaces === undefined
        ? custody.signTransaction(request, options)
        : Promise.resolve(err("refused")),
  };
}

const down = async (): Promise<never> =>
  Promise.reject(new BinferenceError({ code: "chain.rpc_down", message: "Down." }));

// A preparer whose answers a test changes: its call `failPrepareAt` of `prepare`, and its first
// `replace` when `isReplaceDown`, fail as a node that is down; `replace` answers would_fail for
// the kinds `failing` names.
function preparerWith(change: {
  readonly failPrepareAt?: number;
  readonly isReplaceDown?: boolean;
  readonly failing?: readonly string[];
}): (network: FakeNetwork) => TxPreparer {
  return (network) => {
    let prepares = 0;
    let replaces = 0;
    return {
      async prepare(request, options) {
        prepares += 1;
        return prepares === change.failPrepareAt ? down() : network.prepare(request, options);
      },
      async replace(request, options) {
        replaces += 1;
        if (change.isReplaceDown === true && replaces === 1) {
          return down();
        }
        return change.failing?.includes(request.kind) === true
          ? Promise.resolve(err("would_fail"))
          : network.replace(request, options);
      },
    };
  };
}

// The network's reads, but the first read of a nonce fails, as a node that is down.
function nonceDownOnce(network: FakeNetwork): ReceiptReader {
  let isDown = true;
  return {
    head: async (chain, options) => network.head(chain, options),
    transfers: async (chain, hash, options) => network.transfers(chain, hash, options),
    nativeReceived: async (account, block, options) =>
      network.nativeReceived(account, block, options),
    async nonceAt(account, block, options) {
      const wasDown = isDown;
      isDown = false;
      return wasDown ? down() : network.nonceAt(account, block, options);
    },
    receipt: async (chain, hash, options) => network.receipt(chain, hash, options),
  };
}

// Receipts no read sees until the first read of a nonce, as a node a block behind its peers.
function receiptsAfterNonce(network: FakeNetwork): ReceiptReader {
  let isCaughtUp = false;
  return {
    head: async (chain, options) => network.head(chain, options),
    transfers: async (chain, hash, options) => network.transfers(chain, hash, options),
    nativeReceived: async (account, block, options) =>
      network.nativeReceived(account, block, options),
    async nonceAt(account, block, options) {
      isCaughtUp = true;
      return network.nonceAt(account, block, options);
    },
    receipt: async (chain, hash, options) =>
      isCaughtUp ? network.receipt(chain, hash, options) : Promise.resolve(undefined),
  };
}

describe("a stuck step", () => {
  it("gets the same bytes again when a relay dropped it and it is still valid", async () => {
    const bench = await startExecutorBench({ limits });
    const intent = await tapped(bench);
    await flush();
    const [sent] = await transactionsOf(bench);
    bench.network.drop(hashOf(sent));
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(1);
    expect(new Set(bench.sends.map(({ raw }) => raw))).toStrictEqual(new Set([sent?.raw]));
    expect(eventsOf(bench)).toContain("executor.stuck_resent:");
    expect((await transactionsOf(bench)).map(({ state }) => state)).toStrictEqual(["final"]);
    expect(await sentEntriesOf(bench)).toBe(1);
  });

  it("is sped up at its nonce once still valid after the second limit, and fills once", async () => {
    const { bench, intent } = await stuckSwap();
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    const [first, speedUp] = await transactionsOf(bench);
    expect([first?.state, speedUp?.state]).toStrictEqual(["superseded", "final"]);
    expect([first?.nonce, speedUp?.nonce]).toStrictEqual([0, 0]);
    expect(speedUp?.replaces).toStrictEqual({ id: first?.id, kind: "speedUp" });
    expect(bench.signed[1]?.step.replaces).toMatchObject({ kind: "speedUp", nonce: 0 });
    await expect(bench.network.receipt(benchChain, hashOf(first), live())).resolves.toBeUndefined();
    const executions = await executionsOf(bench);
    expect(executions.map(({ txHash }) => txHash)).toStrictEqual([speedUp?.hash]);
    expect(eventsOf(bench)).toContain("executor.stuck_speed_up:");
    expect(await sentEntriesOf(bench)).toBe(2);
  });

  it("is cancelled at its nonce once it fails now, and the intent fails stuck_cancelled", async () => {
    const { bench, intent } = await stuckSwap();
    bench.network.failing(await stepPayload(bench, intent));
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_cancelled");
    const [first, cancel] = await transactionsOf(bench);
    expect([first?.state, cancel?.state]).toStrictEqual(["superseded", "included"]);
    expect(cancel?.replaces).toStrictEqual({ id: first?.id, kind: "cancel" });
    expect(bench.signed[1]?.step.replaces).toStrictEqual({ kind: "cancel", nonce: 0 });
    expect(await executionsOf(bench)).toStrictEqual([]);
    expect(eventsOf(bench)).toContain("executor.stuck_cancel:");
  });

  it("fills once with the transaction it replaced when that one lands first", async () => {
    const { bench, intent } = await stuckSwap();
    bench.network.script("relay-a", { kind: "refuse", reason: "replacement_underpriced" });
    bench.network.script("relay-b", { kind: "refuse", reason: "replacement_underpriced" });
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    expect(bench.signed).toHaveLength(2);
    bench.network.holdBelow(0n);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    const [first, speedUp] = await transactionsOf(bench);
    expect([first?.state, speedUp?.state]).toStrictEqual(["final", "superseded"]);
    const executions = await executionsOf(bench);
    expect(executions.map(({ txHash }) => txHash)).toStrictEqual([first?.hash]);
  });

  it.each<[string, BenchOptions, string]>([
    [
      "whose speed-up would pay above the network fee cap",
      { network: { feeCapBase: held } },
      "over_fee_cap",
    ],
    ["whose replacement custody refuses", { custody: refusingReplacements }, "refused"],
  ])("is handed over, still executing, %s", async (_, options, problem) => {
    const { bench, intent } = await stuckSwap(options);
    await driveUntil(bench, intent, { states: [], blocks: 18 });
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe(`executor.step_stopped:${problem}`);
    expect((await transactionsOf(bench)).map(({ state }) => state)).toStrictEqual(["sent"]);
  });

  it("is handed over when a transaction it never signed used its nonce", async () => {
    const { bench, intent } = await stuckSwap();
    const foreign = "fake-signed|0x0000000c|0x0000000e|1|foreign|0|60000000";
    await bench.network.send({ chain: benchChain, raw: foreign }, live());
    await driveUntil(bench, intent, { states: [], blocks: 5 });
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:nonce_used");
    expect(bench.signed).toHaveLength(1);
  });
});

describe("a stuck step's rules on a node or a preparer that fails", () => {
  it("asks again a block later when no node can say whether the step is still valid", async () => {
    const { bench, intent } = await stuckSwap({ preparer: preparerWith({ failPrepareAt: 2 }) });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(eventsOf(bench)).toContain("executor.read_failed:chain.rpc_down");
    expect(eventsOf(bench)).toContain("executor.stuck_resent:");
  });

  it.each<[string, BenchOptions]>([
    ["no node reads its nonce", { receipts: nonceDownOnce }],
    ["no node prepares its replacement", { preparer: preparerWith({ isReplaceDown: true }) }],
  ])("tries a rule again a block later when %s", async (_, options) => {
    const { bench, intent } = await stuckSwap(options);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(eventsOf(bench)).toContain("executor.read_failed:chain.rpc_down");
    expect(bench.signed).toHaveLength(2);
  });

  it("cancels a stuck cancel again at its nonce, each time for 10% more", async () => {
    const { bench, intent } = await stuckSwap();
    bench.network.failing(await stepPayload(bench, intent));
    bench.network.holdBelow(60_000_000n);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(bench.signed.map(({ step }) => step.replaces?.kind)).toStrictEqual([
      undefined,
      "cancel",
      "cancel",
    ]);
    const states = (await transactionsOf(bench)).map(({ state }) => state);
    expect(states).toStrictEqual(["superseded", "superseded", "included"]);
  });

  it("cancels a step still valid whose speed-up would fail by now", async () => {
    const preparer = preparerWith({ failing: ["speedUp"] });
    const { bench, intent } = await stuckSwap({ preparer });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_cancelled");
  });

  it("is handed over when not even its cancel would go through", async () => {
    const preparer = preparerWith({ failing: ["speedUp", "cancel"] });
    const { bench, intent } = await stuckSwap({ preparer });
    bench.network.failing(await stepPayload(bench, intent));
    await driveUntil(bench, intent, { states: [], blocks: 15 });
    expect(eventsOf(bench).at(-1)).toBe("executor.step_stopped:would_fail");
    expect(bench.signed).toHaveLength(1);
  });

  it("records the step a block holds when a rule's own read finds it", async () => {
    const bench = await startExecutorBench({ limits, receipts: receiptsAfterNonce });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(1);
    expect(eventsOf(bench)).not.toContain("executor.stuck_resent:");
  });
});

// A node that shows a receipt only once the block holding it is final.
function receiptsOnceFinal(network: FakeNetwork): ReceiptReader {
  return {
    head: async (chain, options) => network.head(chain, options),
    transfers: async (chain, hash, options) => network.transfers(chain, hash, options),
    nativeReceived: async (account, block, options) =>
      network.nativeReceived(account, block, options),
    nonceAt: async (account, block, options) => network.nonceAt(account, block, options),
    async receipt(chain, hash, options) {
      const receipt = await network.receipt(chain, hash, options);
      const { final } = await network.head(chain, options);
      return receipt !== undefined && receipt.block.number <= final ? receipt : undefined;
    },
  };
}

describe("a step whose own receipt a node shows late", () => {
  it("is not handed over as another's until its nonce's block is final", async () => {
    const network = { finalityDepth: 8n };
    const bench = await startExecutorBench({ limits, network, receipts: receiptsOnceFinal });
    const intent = await tapped(bench);
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(eventsOf(bench)).not.toContain("executor.step_stopped:nonce_used");
    expect(bench.signed).toHaveLength(1);
  });
});

describe("recovery of a replaced step", () => {
  it("hands a step over as stuck, since recovery never replaces one", async () => {
    const { bench, intent } = await stuckSwap();
    const restarted = await restartBench(bench, { limits });
    await driveUntil(bench, intent, { states: [], blocks: 15 });
    expect(restartEvents(restarted).at(-1)).toBe("executor.step_stopped:stuck");
    expect(restarted.signed).toStrictEqual([]);
  });

  it("reconciles the transaction a speed-up replaced when it landed, and signs nothing", async () => {
    const { bench, intent } = await stuckSwap();
    bench.network.script("relay-a", { kind: "refuse", reason: "replacement_underpriced" });
    bench.network.script("relay-b", { kind: "refuse", reason: "replacement_underpriced" });
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    bench.network.holdBelow(0n);
    bench.network.mine();
    const restarted = await restartBench(bench, { limits });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("reconciled");
    expect(restarted.signed).toStrictEqual([]);
    const [first, speedUp] = await transactionsOf(bench);
    expect([first?.state, speedUp?.state]).toStrictEqual(["final", "superseded"]);
    expect(await executionsOf(bench)).toHaveLength(1);
  });

  it("fails an intent whose cancel landed while the engine was stopped", async () => {
    const { bench, intent } = await stuckSwap();
    bench.network.failing(await stepPayload(bench, intent));
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    await driveUntil(bench, intent, { states: [], blocks: 4 });
    const [, cancel] = await transactionsOf(bench);
    bench.network.script("relay-a", { kind: "accept" });
    await bench.network.send({ chain: benchChain, raw: rawOf(cancel) }, live());
    bench.network.mine();
    const restarted = await restartBench(bench, { limits });
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    expect(await reasonOf(bench, intent)).toBe("stuck_cancelled");
    expect(restarted.signed).toStrictEqual([]);
    expect(restartEvents(restarted)).not.toContain("executor.step_stopped:replaced_step");
    expect(blockOf((await transactionsOf(bench))[1])).toBeGreaterThan(0n);
  });
});
