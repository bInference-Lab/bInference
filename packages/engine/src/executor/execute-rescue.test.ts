import type { AccountRef, AssetRef, Signer, StepAction, TxPreparer } from "@binference/chain";
import { accountRefSchema } from "@binference/chain";
import { createFakeTxSimulator, type FakeNetwork } from "@binference/chain/testing";
import { err, type Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { expectOk, testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall, testChains } from "../operations/test-engine.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import type { IntentStore } from "../ports.js";
import {
  payloadOf,
  rescueCustody,
  rescueSteps,
  secondAccount,
  secondWallet,
  setUpRescue,
  testHeld,
  testMoves,
  testRescue,
  testReserveBase,
} from "../safety/test-rescue.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { TransactionRecord } from "../wallet-queue/transaction-record.js";
import {
  type BenchOptions,
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  hashOf,
  startExecutorBench,
  stateOf,
} from "./test-executor.js";
import { restartBench, restartEvents } from "./test-restart.js";

const live = { signal: new AbortController().signal };
const engine = {
  custodyWallets: rescueCustody,
  held: testHeld,
  chainSimulator: createFakeTxSimulator(rescueSteps()),
};

async function benchWithRescue(options: BenchOptions = {}): Promise<ExecutorBench> {
  const bench = await startExecutorBench({ ...options, engine });
  await setUpRescue(bench.test);
  return bench;
}

// The owner asks for a rescue and taps Confirm on its card.
async function rescueConfirmed(bench: ExecutorBench): Promise<Id<"int">> {
  const handlers = bench.test.engine.handlers;
  const { intent } = expectOk(await handlers["safety/rescue"](testCall({})));
  const view = expectOk(await handlers["intent/get"](testCall({ intent })));
  const args = { intent, card: view.card?.card ?? fixtureId("crd", 0), cardVersion: 1 };
  expectOk(await handlers["intent/confirm"](testCall(args)));
  return intent;
}

// Each wallet holds what testHeld says as live positions, each unit at one micro-dollar.
async function holdPositions(bench: ExecutorBench): Promise<void> {
  const held = [
    { walletId: testWallet, asset: testToken, base: 500n },
    { walletId: testWallet, asset: testCoin, base: 10n ** 18n },
    { walletId: secondWallet, asset: testCoin, base: 5n * 10n ** 17n },
  ] as const;
  await Promise.all(
    held.map(async ({ walletId, asset, base }) => {
      const arrival = { walletId, isPaper: false, atMs: 1, received: { asset, base } };
      const position = {
        walletId,
        asset,
        isPaper: false,
        quantityBase: base,
        costUsdMicros: base,
        realizedUsdMicros: 0n,
        changedAtMs: 1,
      };
      const write = { arrival: { ...arrival, valueUsdMicros: base }, positions: [{ position }] };
      return bench.test.positions.recordArrival(write, live);
    }),
  );
}

// What one account's transactions paid for gas, from their receipts.
function gasPaid(stored: readonly TransactionRecord[], account: AccountRef): bigint {
  return stored
    .filter((transaction) => transaction.account === account)
    .reduce(
      (sum, { receipt }) => sum + (receipt?.gasUsed ?? 0n) * (receipt?.feePerGasBase ?? 0n),
      0n,
    );
}

/** A position as the test compares it: asset, units, cost and realized P&L. */
type Held = readonly [AssetRef, bigint, bigint, bigint];

async function positionsOf(bench: ExecutorBench, walletId: Id<"wal">): Promise<readonly Held[]> {
  const held = await bench.test.positions.positions({ walletId, isPaper: false }, live);
  return held.map(({ asset, quantityBase, costUsdMicros, realizedUsdMicros }): Held => [
    asset,
    quantityBase,
    costUsdMicros,
    realizedUsdMicros,
  ]);
}

// The rescue's first transaction, recorded dropped as the drop rule records one.
async function droppedFirst(bench: ExecutorBench, intent: Id<"int">): Promise<TransactionRecord> {
  const [first] = await bench.test.stores.transactions.ofIntent(intent, live);
  if (first === undefined) {
    throw new Error("Expected the rescue's first transaction.");
  }
  await bench.test.stores.transactions.recordDropped({ id: first.id, atMs: 1 }, live);
  return first;
}

// A new rescue address that took effect a moment ago.
async function moveRescueAddress(bench: ExecutorBench): Promise<void> {
  const other = accountRefSchema.parse("fake:1:0x000000b2");
  const atMs = bench.test.clock.now() - looseningWaitMs - 1;
  await bench.test.stores.install.changeRescue({ address: other, atMs }, live);
}

function noticeKeysOf(bench: ExecutorBench): readonly string[] {
  return bench.pushes
    .filter(({ kind }) => kind === "notice/new")
    .map(({ data }) => /"key":"([^"]+)"/.exec(JSON.stringify(data))?.[1] ?? "");
}

const dayMs = 24 * 60 * 60 * 1_000;

// Custody that answers another account for the second wallet than the one its moves send from.
function strangerForSecond(custody: Signer): Signer {
  const stranger = accountRefSchema.parse("fake:1:0x000000ff");
  return {
    account: async (wallet, chain, options) =>
      wallet === secondWallet
        ? Promise.resolve({ ok: true, value: stranger })
        : custody.account(wallet, chain, options),
    signTransaction: async (request, options) => custody.signTransaction(request, options),
  };
}

// Custody that refuses to sign the rescue's step at `index`.
function refusingStep(index: number): (custody: Signer) => Signer {
  return (custody) => ({
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async (request, options) =>
      request.step.index === index
        ? Promise.resolve(err("refused"))
        : custody.signTransaction(request, options),
  });
}

// Custody that moves the bound bench's rescue address as it is asked to sign the step at
// `index`, then signs it.
function movingAtStep(index: number) {
  const bound: { bench?: ExecutorBench } = {};
  return {
    bind: (bench: ExecutorBench) => {
      bound.bench = bench;
    },
    wrap: (custody: Signer): Signer => ({
      account: async (wallet, chain, options) => custody.account(wallet, chain, options),
      async signTransaction(request, options) {
        if (request.step.index === index && bound.bench !== undefined) {
          await moveRescueAddress(bound.bench);
        }
        return custody.signTransaction(request, options);
      },
    }),
  };
}

// A preparer that moves the bound bench's rescue address as it prepares the step at `index`, as
// a change that takes effect between the step's checks would.
function movingAtPrepare(index: number) {
  const bound: { bench?: ExecutorBench } = {};
  const payload = payloadOf(moveAt(index));
  return {
    bind: (bench: ExecutorBench) => {
      bound.bench = bench;
    },
    wrap: (network: FakeNetwork): TxPreparer => ({
      async prepare(request, options) {
        if (request.draft.payload === payload && bound.bench !== undefined) {
          await moveRescueAddress(bound.bench);
        }
        return network.prepare(request, options);
      },
      replace: async (request, options) => network.replace(request, options),
    }),
  };
}

// Custody whose answer for the step at `index` never comes until the call is cut.
function hangingAtStep(index: number): (custody: Signer) => Signer {
  return (custody) => ({
    account: async (wallet, chain, options) => custody.account(wallet, chain, options),
    signTransaction: async (request, options) =>
      request.step.index === index
        ? new Promise((_, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            });
          })
        : custody.signTransaction(request, options),
  });
}

// An intent store whose move to `reconciled` never lands, as a stop right after finality leaves it.
function unreconciled(store: IntentStore): IntentStore {
  return {
    ...store,
    transition: async (change, options) =>
      change.state === "reconciled" ? err("stale") : store.transition(change, options),
  };
}

function moveAt(index: number) {
  const move = testMoves[index];
  if (move === undefined) {
    throw new Error(`Expected move ${String(index)}.`);
  }
  return move;
}

function sendOf(index: number): StepAction {
  const move = moveAt(index);
  const isToken = index === 0;
  return isToken
    ? {
        kind: "send",
        recipient: testRescue,
        token: "fake:1:0x0000000a" as never,
        amount: move.amount.base,
      }
    : { kind: "send", recipient: testRescue, amount: move.amount.base };
}

describe("a confirmed rescue on its wallets' queues", () => {
  it("ends its card's receipt with the link of its last send", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await driveUntil(bench, intent, { states: ["reconciled"] });
    const last = (await bench.test.stores.transactions.ofIntent(intent, live)).at(-1);
    const showings = createCardShowings({
      ...bench.test.stores,
      chains: testChains(),
      venues: { hasNoDeadline: () => false },
    });
    const ended = await showings.settled(intent, live);
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "landed",
      explorerLink: `https://scan.example.invalid/tx/${hashOf(last)}`,
    });
  });

  it("sends every move from its own wallet to the rescue address, then reconciles", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ wallet, step }) => [wallet, step.index, step.action])).toStrictEqual(
      [
        [testWallet, 0, sendOf(0)],
        [testWallet, 1, sendOf(1)],
        [secondWallet, 2, sendOf(2)],
      ],
    );
    expect(bench.signed.every(({ allowed }) => allowed.recipients.includes(testRescue))).toBe(true);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ account, nonce, state }) => [account, nonce, state])).toStrictEqual([
      [testAccount, 0, "final"],
      [testAccount, 1, "final"],
      [secondAccount, 0, "final"],
    ]);
  });

  it("takes what each send moved and its gas out of the positions at average cost, realizing nothing", async () => {
    const bench = await benchWithRescue();
    await holdPositions(bench);
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    // Each unit costs one micro-dollar, so the cost left is the units left: the reserve less gas.
    const first = testReserveBase - gasPaid(stored, testAccount);
    const second = testReserveBase - gasPaid(stored, secondAccount);
    expect(gasPaid(stored, secondAccount)).toBeGreaterThan(0n);
    await expect(positionsOf(bench, testWallet)).resolves.toStrictEqual([
      [testCoin, first, first, 0n],
      [testToken, 0n, 0n, 0n],
    ]);
    await expect(positionsOf(bench, secondWallet)).resolves.toStrictEqual([
      [testCoin, second, second, 0n],
    ]);
  });

  it("runs while the agent is on paper, since a rescue moves the real funds", async () => {
    const bench = await benchWithRescue({ agent: { mode: "paper" } });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(3);
  });

  it("tries a step that reverts again once its block is final, three times, and sends the rest", async () => {
    const reverting = testMoves.slice(0, 1).map(payloadOf);
    const bench = await benchWithRescue({ network: { reverting } });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"], blocks: 200 })).resolves.toBe(
      "reconciled",
    );
    const indexes = bench.signed.map(({ step }) => step.index);
    expect(indexes).toStrictEqual([0, 0, 0, 0, 1, 2]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ state }) => state)).toStrictEqual([
      "reverted",
      "reverted",
      "reverted",
      "reverted",
      "final",
      "final",
    ]);
  });

  it("is not taken once the address its card confirmed is no longer the rescue address", async () => {
    const bench = await benchWithRescue({ hold: true });
    const intent = await rescueConfirmed(bench);
    const other = accountRefSchema.parse("fake:1:0x000000b2");
    const atMs = bench.test.clock.now() - looseningWaitMs - 1;
    await bench.test.stores.install.changeRescue({ address: other, atMs }, live);
    await bench.release();
    await flush();
    await expect(stateOf(bench, intent)).resolves.toBe("confirmed");
    expect(bench.signed).toStrictEqual([]);
  });

  it("signs no more steps once the rescue address changed while it ran, and alarms", async () => {
    const bench = await benchWithRescue();
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    await moveRescueAddress(bench);
    bench.network.holdBelow(0n);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0]);
    expect(noticeKeysOf(bench)).toContain("notice.rescueStopped");
  });

  it("signs nothing more for a rescue a restart resumes after its address changed", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await flush();
    await moveRescueAddress(bench);
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed).toStrictEqual([]);
  });

  it("records a dropped step that landed after all, and signs it no more", async () => {
    const bench = await benchWithRescue();
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    await droppedFirst(bench, intent);
    bench.network.holdBelow(0n);
    bench.network.mine();
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
  });

  it("signs a dropped step again when none of its transactions landed", async () => {
    const bench = await benchWithRescue();
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    const first = await droppedFirst(bench, intent);
    bench.network.drop(first.hash);
    bench.network.holdBelow(0n);
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([0, 1, 2]);
  });

  it("tries a dropped step that landed and reverted again, as any step that reverts", async () => {
    const reverting = testMoves.slice(0, 1).map(payloadOf);
    const bench = await benchWithRescue({ network: { reverting } });
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    await droppedFirst(bench, intent);
    bench.network.holdBelow(0n);
    bench.network.mine();
    const restarted = await restartBench(bench);
    const goal = { states: ["reconciled" as const], blocks: 200 };
    await expect(driveUntil(bench, intent, goal)).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([0, 0, 0, 1, 2]);
  });

  it("waits a block when no node says whether a dropped step landed", async () => {
    const bench = await benchWithRescue();
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    await droppedFirst(bench, intent);
    bench.network.holdBelow(0n);
    bench.network.mine();
    bench.network.failReads(1);
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
    expect(restartEvents(restarted)).toContain("executor.read_failed:chain.rpc_down");
  });

  it("takes a rescue once while its first work still waits for the queue", async () => {
    const bench = await benchWithRescue({ hold: true });
    const intent = await rescueConfirmed(bench);
    await Promise.all([bench.executor.take(intent, live), bench.executor.take(intent, live)]);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(3);
    const codes = bench.logger.records().map(({ fields }) => fields.errorCode);
    expect(codes).toContain("running");
  });

  it("goes on after a restart without signing a step sent before the stop again", async () => {
    const bench = await benchWithRescue();
    const intent = await rescueConfirmed(bench);
    await flush();
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0]);
    const restarted = await restartBench(bench);
    expect(restarted.recovered).toBe(1);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ step, state }) => [step, state])).toStrictEqual([
      [0, "final"],
      [1, "final"],
      [2, "final"],
    ]);
  });

  it("leaves a step that would fail unsigned, tries it on three more blocks, and sends the rest", async () => {
    const bench = await benchWithRescue();
    bench.network.failing(payloadOf(moveAt(0)));
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
    expect(eventsOf(bench)).toContain("executor.rescue_step_failed:");
  });

  it("signs a step custody refused again on the next block, up to three times", async () => {
    const bench = await benchWithRescue({ custody: refusingStep(1) });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0, 1, 1, 1, 1, 2]);
    const stored = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(stored.map(({ step }) => step)).toStrictEqual([0, 2]);
  });

  it("gives up a reverted step whose block is not final within the finality wait", async () => {
    const reverting = testMoves.slice(0, 1).map(payloadOf);
    const network = { reverting, finalityDepth: 100n };
    const bench = await benchWithRescue({ network, limits: { finalAfterBlocks: 2 } });
    const intent = await rescueConfirmed(bench);
    await driveUntil(bench, intent, { states: [], blocks: 12 });
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0, 1, 2]);
    expect(eventsOf(bench)).toContain("executor.rescue_step_failed:");
    await expect(stateOf(bench, intent)).resolves.toBe("included");
  });

  it("signs no later step once the owner's confirmation ran out while the first waited", async () => {
    const bench = await benchWithRescue();
    bench.network.holdBelow(10n ** 18n);
    const intent = await rescueConfirmed(bench);
    await flush();
    await bench.test.clock.advance(dayMs);
    bench.network.holdBelow(0n);
    const goal = { states: ["reconciled" as const], blocks: 100 };
    await expect(driveUntil(bench, intent, goal)).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0]);
    expect(
      eventsOf(bench).filter((event) => event === "executor.rescue_step_failed:"),
    ).toHaveLength(2);
  });

  it("is not taken when custody holds another account for a wallet it moves from", async () => {
    const bench = await benchWithRescue({ custody: strangerForSecond });
    const intent = await rescueConfirmed(bench);
    await flush();
    await expect(stateOf(bench, intent)).resolves.toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.not_taken:other_sender"]);
    expect(bench.signed).toStrictEqual([]);
  });

  it("is not taken once the owner's confirmation ran out before the queue", async () => {
    const bench = await benchWithRescue({ hold: true });
    const intent = await rescueConfirmed(bench);
    await bench.test.clock.advance(dayMs);
    await bench.release();
    await flush();
    await expect(stateOf(bench, intent)).resolves.toBe("confirmed");
    expect(eventsOf(bench)).toStrictEqual(["executor.move_refused:expired"]);
    expect(bench.signed).toStrictEqual([]);
  });

  it("stops before the next wallet once the rescue address changed after the last step of the first", async () => {
    const moving = movingAtStep(1);
    const bench = await benchWithRescue({ custody: moving.wrap });
    moving.bind(bench);
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0, 1]);
    expect(noticeKeysOf(bench)).toContain("notice.rescueStopped");
  });

  it("signs no step whose rescue address changed while it was prepared", async () => {
    const moving = movingAtPrepare(1);
    const bench = await benchWithRescue({ preparer: moving.wrap });
    moving.bind(bench);
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0]);
    expect(eventsOf(bench)).toContain("executor.rescue_step_failed:");
    expect(noticeKeysOf(bench)).toContain("notice.rescueStopped");
  });

  it("ends a wallet's part at a step stuck at its nonce, and runs the next wallet", async () => {
    const bench = await benchWithRescue({ limits: { stuckAfterBlocks: 2 } });
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    bench.network.failReads(1_000);
    const intent = await rescueConfirmed(bench);
    await driveUntil(bench, intent, { states: [], blocks: 20 });
    expect(bench.signed.map(({ step }) => step.index)).toStrictEqual([0, 2]);
    expect(eventsOf(bench)).toContain("executor.step_stopped:stuck");
  });
});

describe("a rescue a restart finds unsettled", () => {
  it("goes on after a step a stop left in a block, signing only the steps after it", async () => {
    const bench = await benchWithRescue({ custody: hangingAtStep(1) });
    const intent = await rescueConfirmed(bench);
    await driveUntil(bench, intent, { states: [], blocks: 2 });
    const [first] = await bench.test.stores.transactions.ofIntent(intent, live);
    expect(first?.state).toBe("included");
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed.map(({ step }) => step.index)).toStrictEqual([1, 2]);
  });

  it("waits for the blocks of a rescue left included to be final, then reconciles", async () => {
    const bench = await benchWithRescue({ network: { finalityDepth: 6n } });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["included"] })).resolves.toBe("included");
    const restarted = await restartBench(bench);
    expect(restarted.recovered).toBe(1);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed).toStrictEqual([]);
  });

  it("reconciles a rescue a stop left finalized", async () => {
    const bench = await benchWithRescue({ intents: unreconciled });
    const intent = await rescueConfirmed(bench);
    await expect(driveUntil(bench, intent, { states: ["finalized"] })).resolves.toBe("finalized");
    await driveUntil(bench, intent, { states: [], blocks: 3 });
    await expect(stateOf(bench, intent)).resolves.toBe("finalized");
    const restarted = await restartBench(bench);
    await expect(driveUntil(bench, intent, { states: ["reconciled"] })).resolves.toBe("reconciled");
    expect(restarted.signed).toStrictEqual([]);
  });
});
