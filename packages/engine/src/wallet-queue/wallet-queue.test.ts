import { accountRefSchema, type TxHash } from "@binference/chain";
import { createFakeNonceSource } from "@binference/chain/testing";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryTransactionStore } from "../fakes/memory-transaction-store.js";
import type { IntentStatus } from "../intents/intent-status.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { NonceGrant } from "./nonce-grant.js";
import type { SignedTransaction } from "./transaction-record.js";
import { createWalletQueue } from "./wallet-queue.js";
import type { WalletSlot } from "./wallet-slot.js";

const account = accountRefSchema.parse("fake:1:0x0000000a");
const otherAccount = accountRefSchema.parse("fake:1:0x0000000b");
const live = { signal: new AbortController().signal };
const chainStart = 7;

function signedAt(n: number, nonce: number): SignedTransaction {
  return {
    id: fixtureId("tx", n),
    intentId: fixtureId("int", n),
    step: 0,
    account,
    nonce,
    raw: `0x02f8${n.toString(16)}`,
    hash: `0x${n.toString(16).padStart(64, "0")}` as TxHash,
    signedAtMs: 1_000,
  };
}

// One step of intent n, as the execute step runs it: a nonce, a signature, the save.
async function sendStep(slot: WalletSlot, n: number, signal: AbortSignal): Promise<NonceGrant> {
  const grant = await slot.nextNonce({ signal });
  const saved = await slot.saveSigned(signedAt(n, grant.nonce), { signal });
  expect(saved.ok).toBe(true);
  return grant;
}

function setUp() {
  const transactions = createMemoryTransactionStore();
  const nonces = createFakeNonceSource(new Map([[account, chainStart]]));
  const ports = { transactions, nonces, clock: createManualClock(1_000) };
  return { ...ports, ports, queue: createWalletQueue(ports) };
}

const range = (count: number, from = 0): readonly number[] =>
  Array.from({ length: count }, (_, index) => from + index);

type Work<T> = (slot: WalletSlot) => Promise<T>;

const step =
  (n: number): Work<NonceGrant> =>
  async (slot) =>
    sendStep(slot, n, live.signal);

// Intent 17's work stops the engine after it took its nonce, before its signature is stored.
function stepOrStop(n: number, stop: AbortController): Work<NonceGrant> {
  if (n !== 17) {
    return step(n);
  }
  return async (slot) => {
    await slot.nextNonce(stop);
    const crash = new Error("the engine stopped");
    stop.abort(crash);
    throw crash;
  };
}

async function outcomeOf(work: Promise<unknown>): Promise<"sent" | "stopped"> {
  try {
    await work;
    return "sent";
  } catch {
    return "stopped";
  }
}

const confirmed: IntentStatus = {
  state: "confirmed",
  kind: "swap",
  proposer: "agent_runtime",
  isPaper: false,
  hasOutsideContent: false,
  changedAtMs: 9_000,
  quote: { quotedAtMs: 9_000, minOutBase: 1n },
  card: { version: 1, openedAtMs: 9_000, expiresAtMs: 69_000 },
};

// Takes intents as the execute step does: the queue_took move with the policy checked again
// against what earlier takes spent, then one step. Each intent spends 100 USD of a 3,900 USD day.
function takeWithinDay(): (n: number) => Work<number | string> {
  const machine = createIntentStateMachine({ clock: createManualClock(10_000) });
  let spentUsd = 0n;
  return (n) => async (slot) => {
    const took = machine.apply(confirmed, {
      type: "queue_took",
      isAgentLive: true,
      hasPolicyPassed: spentUsd + 100n <= 3_900n,
      confirmation: { cardVersion: 1, expiresAtMs: 69_000 },
    });
    if (!took.ok) {
      return took.error;
    }
    spentUsd += 100n;
    return (await sendStep(slot, n, live.signal)).nonce;
  };
}

// A few microtask turns, enough for another work to start if the queue let it.
async function settle(turns = 10): Promise<void> {
  if (turns > 0) {
    await Promise.resolve();
    await settle(turns - 1);
  }
}

// Works that count how many run at once and record when each starts and ends.
function tracker() {
  const events: string[] = [];
  let running = 0;
  const work = (name: string) => async () => {
    running += 1;
    events.push(`start ${name} with ${String(running)} running`);
    await settle();
    events.push(`end ${name}`);
    running -= 1;
    return name;
  };
  return { events, work };
}

function gate(): { readonly opened: Promise<void>; readonly open: () => void } {
  const opener: { open?: () => void } = {};
  const opened = new Promise<void>((resolve) => {
    opener.open = resolve;
  });
  return { opened, open: () => opener.open?.() };
}

describe("the wallet queue", () => {
  it("gives 40 parallel intents on one wallet 40 distinct nonces with no gap", async () => {
    const { queue, transactions } = setUp();
    const grants = await Promise.all(range(40).map(async (n) => queue.run(account, step(n), live)));
    expect(grants.map(({ nonce }) => nonce)).toStrictEqual(range(40, chainStart));
    expect(grants.some(({ refillsGap }) => refillsGap)).toBe(false);
    const stored = await transactions.list({ account, fromNonce: 0, limit: 100 }, live);
    expect(stored.map(({ nonce }) => nonce)).toStrictEqual(range(40, chainStart));
  });

  it("goes on after a restart mid-run with no nonce used twice and no gap", async () => {
    const { ports, transactions, nonces } = setUp();
    const stop = new AbortController();
    const first = createWalletQueue(ports);
    const outcomes = await Promise.all(
      range(40).map(async (n) => outcomeOf(first.run(account, stepOrStop(n, stop), stop))),
    );
    expect(outcomes).toStrictEqual([
      ...range(17).map(() => "sent"),
      ...range(23).map(() => "stopped"),
    ]);
    // Meanwhile blocks took the first ten, and the chain counts them.
    for (const n of range(10)) {
      transactions.setState(fixtureId("tx", n), "final");
    }
    nonces.set(account, chainStart + 10);
    const second = createWalletQueue(ports);
    const resumed = await Promise.all(
      range(23, 17).map(async (n) => second.run(account, step(n), live)),
    );
    expect(resumed[0]).toStrictEqual({ nonce: chainStart + 17, refillsGap: true });
    const stored = await transactions.list({ account, fromNonce: 0, limit: 100 }, live);
    expect(stored.map(({ nonce }) => nonce)).toStrictEqual(range(40, chainStart));
    expect(new Set(stored.map(({ intentId }) => intentId)).size).toBe(40);
  });

  it("gives a dropped transaction's nonce to the next step first", async () => {
    const { queue, transactions } = setUp();
    await Promise.all(range(3).map(async (n) => queue.run(account, step(n), live)));
    transactions.setState(fixtureId("tx", 1), "dropped");
    await expect(queue.run(account, step(3), live)).resolves.toStrictEqual({
      nonce: chainStart + 1,
      refillsGap: true,
    });
    await expect(queue.run(account, step(4), live)).resolves.toStrictEqual({
      nonce: chainStart + 3,
      refillsGap: false,
    });
  });

  it("gives the nonce of a step the signer refused to the next step", async () => {
    const { queue } = setUp();
    const refused = await queue.run(account, async (slot) => slot.nextNonce(live), live);
    const next = await queue.run(account, step(1), live);
    expect(refused).toStrictEqual({ nonce: chainStart, refillsGap: false });
    expect(next).toStrictEqual({ nonce: chainStart, refillsGap: true });
  });

  it("rechecks each intent inside its slot, where it sees every take before it", async () => {
    const { queue, transactions } = setUp();
    const take = takeWithinDay();
    const outcomes = await Promise.all(
      range(40).map(async (n) => queue.run(account, take(n), live)),
    );
    expect(outcomes).toStrictEqual([...range(39, chainStart), "policy_refused"]);
    const stored = await transactions.list({ account, fromNonce: 0, limit: 100 }, live);
    expect(stored.map(({ nonce }) => nonce)).toStrictEqual(range(39, chainStart));
  });

  it.each([0, 1.5, -2])("refuses %d works as maxWaiting", (maxWaiting) => {
    const { ports } = setUp();
    expect(() => createWalletQueue({ ...ports, maxWaiting })).toThrow(
      expect.objectContaining({ code: "wallet_queue.bad_options", details: { maxWaiting } }),
    );
  });

  it("refuses a work once maxWaiting works wait on the account", async () => {
    const { ports } = setUp();
    const queue = createWalletQueue({ ...ports, maxWaiting: 1 });
    const held = gate();
    const running = queue.run(account, async () => held.opened, live);
    const waiting = queue.run(account, step(1), live);
    await expect(queue.run(account, async () => "over", live)).rejects.toMatchObject({
      code: "wallet_queue.full",
      retryable: true,
      details: { account, waiting: 1 },
    });
    await expect(queue.run(otherAccount, async () => "other", live)).resolves.toBe("other");
    held.open();
    await running;
    await expect(waiting).resolves.toStrictEqual({ nonce: chainStart, refillsGap: false });
    await expect(queue.run(account, async () => "room again", live)).resolves.toBe("room again");
  });

  it("closes the slot when its work ends", async () => {
    const { queue } = setUp();
    const leaked = await queue.run(account, async (slot) => slot, live);
    await expect(leaked.nextNonce(live)).rejects.toMatchObject({
      code: "wallet_queue.slot_closed",
    });
  });
});

describe("the wallet queue's order", () => {
  it("runs one work per account at a time, in arrival order", async () => {
    const { queue } = setUp();
    const { events, work } = tracker();
    const names = await Promise.all(
      ["a", "b", "c"].map(async (name) => queue.run(account, work(name), live)),
    );
    expect(names).toStrictEqual(["a", "b", "c"]);
    expect(events).toStrictEqual([
      "start a with 1 running",
      "end a",
      "start b with 1 running",
      "end b",
      "start c with 1 running",
      "end c",
    ]);
  });

  it("runs accounts side by side", async () => {
    const { queue } = setUp();
    const held = gate();
    const blocked = queue.run(account, async () => held.opened, live);
    await expect(queue.run(otherAccount, async () => "other", live)).resolves.toBe("other");
    held.open();
    await expect(blocked).resolves.toBeUndefined();
  });

  it("goes on after a work that fails, and passes its error on", async () => {
    const { queue } = setUp();
    const failure = new Error("refused");
    const failing = queue.run(account, async () => Promise.reject(failure), live);
    const next = queue.run(account, async () => "next", live);
    await expect(failing).rejects.toBe(failure);
    await expect(next).resolves.toBe("next");
    await expect(queue.run(account, async () => "again", live)).resolves.toBe("again");
  });

  it("goes on after a work that throws before it awaits", async () => {
    const { queue } = setUp();
    const failure = new Error("thrown at once");
    const throwing = queue.run(
      account,
      () => {
        throw failure;
      },
      live,
    );
    await expect(throwing).rejects.toBe(failure);
    await expect(queue.run(account, async () => "after", live)).resolves.toBe("after");
  });

  it("drops a waiting work whose signal aborts, and never runs it", async () => {
    const { queue } = setUp();
    const held = gate();
    const blocked = queue.run(account, async () => held.opened, live);
    const controller = new AbortController();
    const { events, work } = tracker();
    const waiting = queue.run(account, work("dropped"), controller);
    const behind = queue.run(account, async () => "behind", live);
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    held.open();
    await expect(blocked).resolves.toBeUndefined();
    await expect(behind).resolves.toBe("behind");
    expect(events).toStrictEqual([]);
  });

  it("refuses a work whose signal aborted before it arrived", async () => {
    const { queue } = setUp();
    const reason = new Error("stopped early");
    await expect(
      queue.run(account, async () => "never", { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    await expect(queue.run(account, async () => "next", live)).resolves.toBe("next");
  });

  it("keeps the works behind a started work whose signal aborts while it runs", async () => {
    const { queue } = setUp();
    const held = gate();
    const first = queue.run(account, async () => held.opened, live);
    const controller = new AbortController();
    const started = gate();
    const running = queue.run(
      account,
      async () => {
        started.open();
        await settle();
        return "ran";
      },
      controller,
    );
    const behind = queue.run(account, async () => "behind", live);
    held.open();
    await first;
    await started.opened;
    controller.abort(new Error("stopped while it ran"));
    await expect(running).resolves.toBe("ran");
    await expect(behind).resolves.toBe("behind");
  });
});
