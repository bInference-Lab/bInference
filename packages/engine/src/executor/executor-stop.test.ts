import type { ReceiptReader, RelaySender, Signer, TxPreparer } from "@binference/chain";
import type { FakeNetwork } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testCoin, testSwap, testToken } from "../intents/test-intents.js";
import type { IntentStore } from "../ports.js";
import {
  driveUntil,
  eventsOf,
  type ExecutorBench,
  flush,
  startExecutorBench,
  stateOf,
  tapped,
  transactionsOf,
} from "./test-executor.js";

const live = () => ({ signal: new AbortController().signal });
// A sale of the token: an exact approval to the fake router, then the swap.
const tokenSale = testSwap({ from: testToken, to: testCoin, amount: { base: 1_000_000n } });

/** A point a test holds a call at: `reached` once the call arrives, until `open`. */
interface Gate {
  readonly reached: Promise<void>;
  readonly arrive: () => void;
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function gate(): Gate {
  const sides = { arrive: (): void => undefined, open: (): void => undefined };
  const reached = new Promise<void>((resolve) => {
    sides.arrive = resolve;
  });
  const opened = new Promise<void>((resolve) => {
    sides.open = resolve;
  });
  return { reached, opened, arrive: () => sides.arrive(), open: () => sides.open() };
}

function heldSender(held: Gate): (sender: RelaySender) => RelaySender {
  return (sender) => ({
    relays: sender.relays,
    async send(transaction, call) {
      held.arrive();
      await held.opened;
      return sender.send(transaction, call);
    },
  });
}

function heldCustody(held: Gate): (custody: Signer) => Signer {
  return (custody) => ({
    account: async (wallet, chain, call) => custody.account(wallet, chain, call),
    async signTransaction(request, call) {
      held.arrive();
      await held.opened;
      return custody.signTransaction(request, call);
    },
  });
}

// A send that hangs until its call is cut.
function hangingSender(held: Gate): (sender: RelaySender) => RelaySender {
  return (sender) => ({
    relays: sender.relays,
    async send(_transaction, call) {
      held.arrive();
      return new Promise((_resolve, reject) => {
        call.signal.addEventListener("abort", () => reject(call.signal.reason), { once: true });
      });
    },
  });
}

// The first receipt read waits at the gate; every other read goes straight to the network.
function heldFirstReceipt(held: Gate): (network: FakeNetwork) => ReceiptReader {
  const reads = { count: 0 };
  return (network) => ({
    head: async (chain, call) => network.head(chain, call),
    nonceAt: async (account, block, call) => network.nonceAt(account, block, call),
    transfers: async (chain, hash, call) => network.transfers(chain, hash, call),
    nativeReceived: async (account, block, call) => network.nativeReceived(account, block, call),
    isKnown: async (chain, hash, call) => network.isKnown(chain, hash, call),
    async receipt(chain, hash, call) {
      reads.count += 1;
      if (reads.count === 1) {
        held.arrive();
        await held.opened;
      }
      return network.receipt(chain, hash, call);
    },
  });
}

// Every read of a confirmation after the one `take` makes, the first in the queue's slot, waits
// at the gate.
function heldConfirmation(held: Gate): (store: IntentStore) => IntentStore {
  const reads = { count: 0 };
  return (store) => ({
    ...store,
    async confirmation(intent, call) {
      reads.count += 1;
      if (reads.count > 1) {
        held.arrive();
        await held.opened;
      }
      return store.confirmation(intent, call);
    },
  });
}

// The executor's first move of an intent, the queue taking it, waits at the gate.
function heldFirstMove(held: Gate): (store: IntentStore) => IntentStore {
  const moves = { count: 0 };
  return (store) => ({
    ...store,
    async transition(move, call) {
      moves.count += 1;
      if (moves.count === 1) {
        held.arrive();
        await held.opened;
      }
      return store.transition(move, call);
    },
  });
}

// The network's preparer, but a stuck step's replacement waits at the gate.
function heldReplacement(held: Gate): (network: FakeNetwork) => TxPreparer {
  return (network) => ({
    prepare: async (request, options) => network.prepare(request, options),
    async replace(request, options) {
      held.arrive();
      await held.opened;
      return network.replace(request, options);
    },
  });
}

// Starts the executor's stop and tells whether it has ended.
function closing(bench: ExecutorBench) {
  const state = { hasEnded: false };
  const closed = (async () => {
    await bench.executor.close(live());
    state.hasEnded = true;
  })();
  return { closed, hasEnded: () => state.hasEnded };
}

describe("the executor's stop", () => {
  it("finishes a broadcast under way, records it, then stops watching", async () => {
    const held = gate();
    const bench = await startExecutorBench({ sender: heldSender(held) });
    const intent = await tapped(bench);
    await held.reached;
    const stop = closing(bench);
    await flush();
    expect(stop.hasEnded()).toBe(false);
    held.open();
    await stop.closed;
    const [step] = await transactionsOf(bench);
    expect(step?.state).toBe("sent");
    expect(bench.network.received()).toHaveLength(2);
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).slice(-2)).toStrictEqual([
      "executor.sent:",
      "executor.failed:engine.stopping",
    ]);
  });

  it("finishes a signature under way: the step is stored, then sent once", async () => {
    const held = gate();
    const bench = await startExecutorBench({ custody: heldCustody(held) });
    await tapped(bench);
    await held.reached;
    const stop = closing(bench);
    await flush();
    expect(stop.hasEnded()).toBe(false);
    held.open();
    await stop.closed;
    const stored = await transactionsOf(bench);
    expect(stored.map(({ state }) => state)).toStrictEqual(["sent"]);
    expect([bench.signed.length, bench.network.sends()]).toStrictEqual([1, 1]);
  });

  it("leaves an intent waiting behind another on its wallet confirmed, with nothing signed", async () => {
    const held = gate();
    const bench = await startExecutorBench({ custody: heldCustody(held) });
    await tapped(bench);
    await held.reached;
    const second = await tapped(bench);
    await flush();
    const stop = closing(bench);
    await flush();
    held.open();
    await stop.closed;
    expect(await stateOf(bench, second)).toBe("confirmed");
    expect(bench.signed).toHaveLength(1);
    await expect(bench.executor.take(second, live())).rejects.toMatchObject({
      code: "engine.executor_closed",
    });
  });

  it("leaves an intent confirmed when the stop comes while the queue checks it", async () => {
    const held = gate();
    const bench = await startExecutorBench({ intents: heldConfirmation(held) });
    const intent = await tapped(bench);
    await held.reached;
    const stop = closing(bench);
    held.open();
    await stop.closed;
    expect(await stateOf(bench, intent)).toBe("confirmed");
    expect(bench.signed).toHaveLength(0);
    expect(eventsOf(bench)).toContain("executor.not_taken:stopping");
  });

  it("cancels an intent the queue took when the stop comes before its first signature", async () => {
    const held = gate();
    const bench = await startExecutorBench({ intents: heldFirstMove(held) });
    const intent = await tapped(bench);
    await held.reached;
    const stop = closing(bench);
    held.open();
    await stop.closed;
    expect(await stateOf(bench, intent)).toBe("cancelled");
    expect(bench.signed).toHaveLength(0);
    const notices = bench.pushes.filter((push) => push.kind === "notice/new");
    expect(notices.at(-1)?.data).toMatchObject({ key: "notice.notSigned", intent });
  });

  it("signs no later step once the engine stops, and ends the intent as never signed", async () => {
    const held = gate();
    const bench = await startExecutorBench({ receipts: heldFirstReceipt(held) });
    const intent = await tapped(bench, tokenSale);
    await held.reached;
    bench.network.mine();
    const stop = closing(bench);
    held.open();
    await stop.closed;
    expect(await stateOf(bench, intent)).toBe("failed_onchain");
    expect(bench.signed).toHaveLength(1);
    const notices = bench.pushes.filter((push) => push.kind === "notice/new");
    expect(notices.at(-1)?.data).toMatchObject({ key: "notice.stepUnsent", intent });
  });

  it("ends a watch at once, without waiting for the next block", async () => {
    const bench = await startExecutorBench();
    bench.network.script("relay-a", { kind: "hang" });
    bench.network.script("relay-b", { kind: "hang" });
    const intent = await tapped(bench);
    await flush();
    await bench.executor.close(live());
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.stopping");
  });

  it("cuts a send under way once its signal aborts, leaving the step stored and unsent", async () => {
    const held = gate();
    const bench = await startExecutorBench({ sender: hangingSender(held) });
    await tapped(bench);
    await held.reached;
    await bench.executor.close({ signal: AbortSignal.abort() });
    const stored = await transactionsOf(bench);
    expect(stored.map(({ state }) => state)).toStrictEqual(["signed"]);
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.stopping");
  });

  it("signs no replacement of a stuck step once the engine stops", async () => {
    const held = gate();
    const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };
    const bench = await startExecutorBench({ limits, preparer: heldReplacement(held) });
    bench.network.holdBelow(52_000_000n);
    const intent = await tapped(bench);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    await held.reached;
    const stop = closing(bench);
    held.open();
    await stop.closed;
    expect(bench.signed).toHaveLength(1);
    expect(await stateOf(bench, intent)).toBe("executing");
    expect(eventsOf(bench).at(-1)).toBe("executor.failed:engine.stopping");
  });
});
