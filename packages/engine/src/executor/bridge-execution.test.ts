import { accountRefSchema, type AssetRef } from "@binference/chain";
import type { RelayBehavior } from "@binference/chain/testing";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import {
  bridgeLimits,
  testBridge,
  testFarEntry,
  testRescue,
  testRescueThere,
  testSpoke,
} from "../bridges/test-bridges.js";
import { planDocument } from "../intents/intent-documents.schema.js";
import { testAgent, testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { type BridgeBench, bridgeBench } from "./test-bridge-bench.js";
import { benchChain, driveUntil, flush, stateOf, tapped } from "./test-executor.js";

const live = { signal: new AbortController().signal };
const held0 = 1_000_000_000n;
const coin0 = 10n ** 18n;
// The rules run at 3 and 6 blocks, and a step every relay refuses is dropped after 9.
const limits = { stuckAfterBlocks: 3, replaceAfterBlocks: 6, droppedAfterBlocks: 9 };

const signedSteps = [
  "finalized",
  "reconciled",
  "failed_check",
  "failed_onchain",
  "expired",
] as const;

// Both relays answer each send the same way.
function refuse(bench: BridgeBench, answer: RelayBehavior): void {
  bench.network.script("relay-a", answer);
  bench.network.script("relay-b", answer);
}

// The test wallet holds `base` of the asset as a live position, each unit at one micro-dollar.
async function hold(bench: BridgeBench, asset: AssetRef, base = held0): Promise<void> {
  const position = {
    walletId: testWallet,
    asset,
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
    received: { asset, base },
    valueUsdMicros: base,
  };
  await bench.test.positions.recordArrival({ arrival, positions: [{ position }] }, live);
}

// The signed bytes of the speed-up the drop rule ended the deposit with.
async function depositSpeedUp(bench: BridgeBench, intent: Id<"int">): Promise<string> {
  const [, , speedUp] = await bench.test.stores.transactions.ofIntent(intent, live);
  if (speedUp === undefined) {
    throw new Error("Expected the deposit's speed-up.");
  }
  return speedUp.raw;
}

describe("a bridge on its wallet's queue", () => {
  it("signs its approval, then its deposit held to the card's recipient, chain and least output", async () => {
    const bench = await bridgeBench();
    const intent = await tapped(bench, testBridge());
    await bench.release();
    expect(await driveUntil(bench, intent, { states: signedSteps })).toBe("finalized");

    expect(bench.signed.map(({ step }) => step.action.kind)).toStrictEqual(["approve", "call"]);
    expect(
      bench.signed.map(({ allowed }) => [allowed.contracts, allowed.spenders, allowed.recipients]),
    ).toStrictEqual([
      [[testSpoke], [testSpoke], []],
      [[testSpoke], [testSpoke], []],
    ]);
  });

  it("keeps a bridge to the rescue address unsigned once code appears there after its card", async () => {
    const bench = await bridgeBench();
    const intent = await tapped(bench, testBridge({ rescue: true }));
    bench.fakes.codesThere.place(testRescueThere, "contract");
    await bench.release();
    await expect(driveUntil(bench, intent, { states: signedSteps, blocks: 5 })).resolves.toBe(
      "confirmed",
    );
    expect(bench.signed).toStrictEqual([]);
  });
});

// A bridge whose deposit every relay refuses until it is dropped after its approval landed, then
// sent again as a relay the drop rule could not see would; the intent ends `failed_onchain` first.
async function droppedThenLanded(bench: BridgeBench): Promise<Id<"int">> {
  await hold(bench, testToken);
  await hold(bench, testCoin, coin0);
  const intent = await tapped(bench, testBridge());
  await bench.release();
  await flush();
  refuse(bench, { kind: "refuse", reason: "insufficient_funds" });
  await expect(driveUntil(bench, intent, { states: signedSteps })).resolves.toBe("failed_onchain");
  refuse(bench, { kind: "accept" });
  await bench.network.send({ chain: benchChain, raw: await depositSpeedUp(bench, intent) }, live);
  await driveUntil(bench, intent, { states: [], blocks: 8 });
  return intent;
}

// What the wallet's token and coin positions hold, and what was booked as a trade.
async function bookedOf(bench: BridgeBench) {
  const held = await bench.test.positions.positions({ walletId: testWallet, isPaper: false }, live);
  const executions = await bench.test.positions.executions(
    { isPaper: false, after: 0, limit: 10 },
    live,
  );
  const of = (asset: AssetRef) => held.find((position) => position.asset === asset)?.quantityBase;
  return { token: of(testToken), coin: of(testCoin), executions };
}

// What the intent's transactions that a block ran paid for gas.
async function gasOf(bench: BridgeBench, intent: Id<"int">): Promise<bigint> {
  const stored = await bench.test.stores.transactions.ofIntent(intent, live);
  return stored
    .filter(({ state }) => state === "final" || state === "reverted")
    .reduce(
      (sum, { receipt }) => sum + (receipt?.gasUsed ?? 0n) * (receipt?.feePerGasBase ?? 0n),
      0n,
    );
}

// The deposit's draft payload, as a bench with the same fakes plans it.
async function depositPayload(): Promise<string> {
  const bench = await bridgeBench();
  const intent = await tapped(bench, testBridge());
  const stored = await bench.test.stores.intents.get(intent, live);
  const steps = planDocument.decode(stored?.plan ?? null);
  return steps.at(-1)?.payload ?? "";
}

describe("a bridge whose dropped deposit lands after all", () => {
  it("takes the amount sent out of its position once, books no trade, and leaves it failed", async () => {
    const bench = await bridgeBench({ limits });
    const intent = await droppedThenLanded(bench);
    const gas = await gasOf(bench, intent);
    expect([await stateOf(bench, intent), await bookedOf(bench)]).toStrictEqual([
      "failed_onchain",
      { token: held0 - 100_000_000n, coin: coin0 - gas, executions: [] },
    ]);
    expect(await bench.test.stores.bridges.get(intent, live)).toBeUndefined();
  });

  it("takes no token out of its position when the late deposit reverts, only both steps' gas", async () => {
    const bench = await bridgeBench({ limits, reverting: [await depositPayload()] });
    const intent = await droppedThenLanded(bench);
    const gas = await gasOf(bench, intent);
    expect(gas).toBeGreaterThan(0n);
    expect([await stateOf(bench, intent), await bookedOf(bench)]).toStrictEqual([
      "failed_onchain",
      { token: held0, coin: coin0 - gas, executions: [] },
    ]);
  });
});

// A tapped bridge, then a change of the world before the queue takes it: the queue keeps it
// confirmed and signs nothing.
async function heldAfter(
  change: (bench: BridgeBench) => Promise<unknown>,
  request = testBridge(),
  options: Parameters<typeof bridgeBench>[0] = {},
) {
  const bench = await bridgeBench(options);
  const intent = await tapped(bench, request);
  await change(bench);
  await bench.release();
  const state = await driveUntil(bench, intent, { states: signedSteps, blocks: 5 });
  return { state, signed: bench.signed };
}

// The data of the notices the bench published with the key.
function noticesOf(bench: BridgeBench, key: string) {
  return bench.pushes
    .filter((push) => push.kind === "notice/new" && JSON.stringify(push.data).includes(key))
    .map(({ data }) => data);
}

// Takes the fake bridge out of the agent's venues, as a stricter limit applies at once.
async function withoutBridgeVenue(bench: BridgeBench) {
  const settings = await bench.test.stores.agents.get(testAgent, live);
  const narrowed = { ...bridgeLimits, venues: ["fake-swap"] };
  const expectedVersion = settings?.limits.version ?? 0;
  const change = { agentId: testAgent, limits: narrowed, atMs: testNowMs, expectedVersion };
  return bench.test.stores.agents.setLimits(change, live);
}

describe("a confirmed bridge the queue checks again", () => {
  it("stays unsigned once its quote expired by the engine's clock", async () => {
    const held = await heldAfter(async (bench) => bench.test.clock.advance(60_001));
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it("stays unsigned once another rescue address took effect after its card", async () => {
    const moved = accountRefSchema.parse("fake:1:0x000000d8");
    const change = { address: moved, atMs: testNowMs - 2 * looseningWaitMs };
    const held = await heldAfter(
      async (bench) => bench.test.stores.install.changeRescue(change, live),
      testBridge({ rescue: true }),
    );
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it("stays unsigned once code appears at the rescue address on its own chain", async () => {
    const held = await heldAfter(
      async (bench) => {
        bench.fakes.codesHere.place(testRescue, "contract");
        await Promise.resolve();
      },
      testBridge({ rescue: true }),
    );
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it("stays unsigned while the destination cannot say whether the rescue address holds code", async () => {
    const held = await heldAfter(
      async (bench) => {
        bench.fakes.codesThere.down();
        await Promise.resolve();
      },
      testBridge({ rescue: true }),
    );
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it.each(["home", "there"] as const)(
    "stays unsigned while nothing can read code at the rescue address on the %s chain",
    async (side) => {
      const held = await heldAfter(async () => Promise.resolve(), testBridge({ rescue: true }), {
        withoutCodes: side,
      });
      expect(held).toStrictEqual({ state: "confirmed", signed: [] });
    },
  );

  it("stays unsigned once its venue left the agent's limits", async () => {
    const held = await heldAfter(withoutBridgeVenue);
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it("stays unsigned once its entry left the address book", async () => {
    const removal = { id: testFarEntry.id, atMs: testNowMs };
    const held = await heldAfter(async (bench) =>
      bench.test.stores.agents.removeAddress(removal, live),
    );
    expect(held).toStrictEqual({ state: "confirmed", signed: [] });
  });

  it("tells a bridge that lapsed unsigned what held it, the owner's own change first", async () => {
    const bench = await bridgeBench();
    const intent = await tapped(bench, testBridge({ rescue: true }));
    const moved = accountRefSchema.parse("fake:1:0x000000d8");
    await bench.test.stores.install.changeRescue(
      { address: moved, atMs: testNowMs - 2 * looseningWaitMs },
      live,
    );
    await bench.release();
    await driveUntil(bench, intent, { states: signedSteps, blocks: 2 });
    await bench.test.clock.advance(11 * 60_000);
    expect(await driveUntil(bench, intent, { states: signedSteps })).toBe("expired");
    expect(noticesOf(bench, "notice.bridgeLapsed")).toMatchObject([
      { key: "notice.bridgeLapsed", values: { chain: "Fake Two", why: "rescue" } },
    ]);
  });
});
