import { accountRefSchema, type Amount } from "@binference/chain";
import type { FakeNameResolver } from "@binference/chain/testing";
import { createFakeFamily } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { planDocument } from "../intents/intent-documents.schema.js";
import { testCoin, testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import type { IntentStore } from "../ports.js";
import { saveTestAddress, testSaved } from "../send-levels/test-sends.js";
import {
  holdTestWallet,
  testNames,
  testRevoke,
  testRouter,
  testSend,
  transferSimulator,
} from "../sends/test-transfers.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import {
  benchChain,
  driveUntil,
  type ExecutorBench,
  startExecutorBench,
  stateOf,
  tapped,
} from "./test-executor.js";

const live = { signal: new AbortController().signal };
const coin: Amount = { asset: testCoin, base: 10n ** 15n };
const later = accountRefSchema.parse("fake:1:0x000000f2");
const tokenContract = accountRefSchema.parse("fake:1:0x0000000a");
const done = ["reconciled", "failed_check", "failed_onchain", "expired", "cancelled"] as const;

async function benchWith(names: FakeNameResolver = testNames()): Promise<ExecutorBench> {
  const bench = await startExecutorBench({
    hold: true,
    engine: {
      nameResolvers: [names],
      chainSimulator: transferSimulator(
        [{ to: testSaved.account, amount: coin }],
        [{ token: testToken, spender: testRouter }],
      ),
    },
  });
  await saveTestAddress(bench.test);
  holdTestWallet(bench.test);
  return bench;
}

function notices(bench: ExecutorBench) {
  return bench.pushes.flatMap((push) => (push.kind === "notice/new" ? [push.data] : []));
}

// The test wallet holds one coin as a live position, each unit at one micro-dollar.
async function holdCoin(bench: ExecutorBench): Promise<void> {
  const base = 10n ** 18n;
  const position = {
    walletId: testWallet,
    asset: testCoin,
    isPaper: false,
    quantityBase: base,
    costUsdMicros: base,
    realizedUsdMicros: 0n,
    changedAtMs: 1,
  };
  const arrival = {
    walletId: testWallet,
    isPaper: false,
    atMs: 1,
    received: { asset: testCoin, base },
  };
  await bench.test.positions.recordArrival(
    { arrival: { ...arrival, valueUsdMicros: base }, positions: [{ position }] },
    live,
  );
}

// What the coin's position holds after the intent, and what its transactions paid for gas.
async function coinAfter(bench: ExecutorBench, intent: Id<"int">) {
  const [held] = await bench.test.positions.positions(
    { walletId: testWallet, isPaper: false },
    live,
  );
  const stored = await bench.test.stores.transactions.ofIntent(intent, live);
  const gas = stored.reduce(
    (sum, { receipt }) => sum + (receipt?.gasUsed ?? 0n) * (receipt?.feePerGasBase ?? 0n),
    0n,
  );
  return { held: held?.quantityBase, gas };
}

// The signed bytes of an intent's speed-up, its second stored transaction.
async function speedUpRaw(bench: ExecutorBench, intent: Id<"int">): Promise<string> {
  const [, speedUp] = await bench.test.stores.transactions.ofIntent(intent, live);
  if (speedUp === undefined) {
    throw new Error("Expected a speed-up.");
  }
  return speedUp.raw;
}

async function reasonOf(bench: ExecutorBench, intent: Id<"int">) {
  return (await bench.test.stores.intents.get(intent, live))?.reason;
}

describe("a send on its wallet's queue", () => {
  it("signs one send to the address its card confirmed, and reconciles it as a departure", async () => {
    const bench = await benchWith();
    await holdCoin(bench);
    const intent = await tapped(bench, testSend());
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step, allowed }) => [step.action, allowed])).toStrictEqual([
      [
        { kind: "send", recipient: testSaved.account, amount: coin.base },
        { contracts: [], spenders: [], recipients: [testSaved.account] },
      ],
    ]);
    const { held, gas } = await coinAfter(bench, intent);
    expect(gas).toBeGreaterThan(0n);
    expect(held).toBe(10n ** 18n - coin.base - gas);
  });

  it("signs a revoke as an approval of 0 to its spender alone, and departs only its gas", async () => {
    const bench = await benchWith();
    const intent = await tapped(bench, testRevoke(testToken));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    expect(bench.signed.map(({ step, allowed }) => [step.action, allowed.spenders])).toStrictEqual([
      [{ kind: "approve", token: tokenContract, spender: testRouter, amount: 0n }, [testRouter]],
    ]);
  });
});

// The executor's intent store reads a revoke's plan as a draft that approves 1, not 0.
function approvingOne(store: IntentStore): IntentStore {
  const draft = createFakeFamily().approvalDraft({
    from: testAccount,
    token: tokenContract,
    spender: testRouter,
    amountBase: 1n,
  });
  const plan = draft.ok ? planDocument.encode([draft.value]) : undefined;
  return {
    ...store,
    async get(id, call) {
      const record = await store.get(id, call);
      return record?.kind === "revokeApproval" && plan !== undefined ? { ...record, plan } : record;
    },
  };
}

describe("a revoke's signing request", () => {
  it("asks for an approval of exactly zero, whatever its draft encodes", async () => {
    const names = testNames();
    const bench = await startExecutorBench({
      hold: true,
      intents: approvingOne,
      engine: {
        nameResolvers: [names],
        chainSimulator: transferSimulator([], [{ token: testToken, spender: testRouter }]),
      },
    });
    holdTestWallet(bench.test);
    const intent = await tapped(bench, testRevoke(testToken));
    await bench.release();
    await driveUntil(bench, intent, { states: done });
    expect(bench.signed.map(({ step }) => step.action)).toStrictEqual([
      { kind: "approve", token: tokenContract, spender: testRouter, amount: 0n },
    ]);
  });
});

describe("a send whose dropped step lands after all", () => {
  it("leaves the positions as its departure, and its intent failed", async () => {
    const bench = await startExecutorBench({
      limits: { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 },
      engine: { chainSimulator: transferSimulator([{ to: testSaved.account, amount: coin }]) },
    });
    await saveTestAddress(bench.test);
    await holdCoin(bench);
    const refusing = { kind: "refuse", reason: "insufficient_funds" } as const;
    bench.network.script("relay-a", refusing);
    bench.network.script("relay-b", refusing);
    const intent = await tapped(bench, testSend());
    const settled = { states: ["reconciled", "failed_onchain"] } as const;
    await expect(driveUntil(bench, intent, settled)).resolves.toBe("failed_onchain");
    const raw = await speedUpRaw(bench, intent);
    bench.network.script("relay-a", { kind: "accept" });
    bench.network.script("relay-b", { kind: "accept" });
    await bench.network.send({ chain: benchChain, raw }, live);
    await driveUntil(bench, intent, { states: [], blocks: 8 });
    const { held, gas } = await coinAfter(bench, intent);
    expect([await stateOf(bench, intent), held]).toStrictEqual([
      "failed_onchain",
      10n ** 18n - coin.base - gas,
    ]);
  });
});

describe("a send by name on its wallet's queue", () => {
  it("signs when the name still points to its card's address", async () => {
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const bench = await benchWith(names);
    const intent = await tapped(bench, testSend({ name: "alice.bnb" }));
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
    expect(bench.signed).toHaveLength(1);
  });

  it("ends name_moved with the owner's notice when the name moved after its card, signing nothing", async () => {
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const bench = await benchWith(names);
    const intent = await tapped(bench, testSend({ name: "alice.bnb" }));
    names.set("alice.bnb", { address: later });
    await bench.release();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("failed_check");
    await expect(reasonOf(bench, intent)).resolves.toBe("name_moved");
    expect(bench.signed).toHaveLength(0);
    const showings = createCardShowings({
      ...bench.test.stores,
      chains: testChains(),
      venues: { hasNoDeadline: () => false },
    });
    const ended = await showings.settled(intent, live);
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "refused",
      reason: "name_moved",
      name: "alice.bnb",
    });
    expect(notices(bench)).toMatchObject([
      {
        key: "notice.nameMoved",
        values: {
          name: "alice.bnb",
          now: "address",
          address: "0x000000f2",
          confirmed: "0x000000f1",
        },
      },
    ]);
  });

  it("ends name_moved when the name points nowhere, or to the same address as a contract", async () => {
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const bench = await benchWith(names);
    const gone = await tapped(bench, testSend({ name: "alice.bnb" }));
    names.set("alice.bnb", undefined);
    await bench.release();
    await expect(driveUntil(bench, gone, { states: done })).resolves.toBe("failed_check");
    expect(notices(bench)).toMatchObject([{ values: { now: "none", address: "" } }]);
  });

  it("signs nothing and waits while the name service does not answer, then goes on", async () => {
    const names = testNames();
    names.set("alice.bnb", { address: testSaved.account });
    const bench = await benchWith(names);
    const intent = await tapped(bench, testSend({ name: "alice.bnb" }));
    names.down();
    await bench.release();
    await driveUntil(bench, intent, { states: done, blocks: 3 });
    await expect(stateOf(bench, intent)).resolves.toBe("confirmed");
    expect(bench.signed).toHaveLength(0);
    names.up();
    await expect(driveUntil(bench, intent, { states: done })).resolves.toBe("reconciled");
  });
});
