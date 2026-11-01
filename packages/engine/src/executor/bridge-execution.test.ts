import { accountRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import {
  bridgeEngineOptions,
  bridgeFakes,
  bridgeLimits,
  readyBridges,
  testBridge,
  testFarEntry,
  testRescueThere,
  testSpoke,
} from "../bridges/test-bridges.js";
import { testAgent, testNowMs, testToken } from "../intents/test-intents.js";
import { looseningWaitMs } from "../policy/send-level-change.js";
import { driveUntil, type ExecutorBench, startExecutorBench, tapped } from "./test-executor.js";

const signedSteps = [
  "finalized",
  "reconciled",
  "failed_check",
  "failed_onchain",
  "expired",
] as const;

// A bench whose engine and executor bridge through the fake bridge, ready to bridge.
async function bridgeBench(): Promise<
  ExecutorBench & { readonly fakes: ReturnType<typeof bridgeFakes> }
> {
  const fakes = bridgeFakes();
  const engine = bridgeEngineOptions(fakes);
  const { agent: _agent, ...rest } = engine;
  const destinations = engine.destinations ?? [];
  const bench = await startExecutorBench({
    hold: true,
    agent: engine.agent ?? {},
    engine: rest,
    prices: new Map([[testToken, { numerator: 1_000_000n, denominator: 1_000_000n }]]),
    bridging: {
      chains: fakes.chains,
      bridging: { bridges: [fakes.bridge], destinations, codeReaders: [fakes.codesHere] },
    },
  });
  await readyBridges(bench.test);
  return { ...bench, fakes };
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

const live = { signal: new AbortController().signal };

// A tapped bridge, then a change of the world before the queue takes it: the queue keeps it
// confirmed and signs nothing.
async function heldAfter(
  change: (bench: Awaited<ReturnType<typeof bridgeBench>>) => Promise<unknown>,
  request = testBridge(),
) {
  const bench = await bridgeBench();
  const intent = await tapped(bench, request);
  await change(bench);
  await bench.release();
  const state = await driveUntil(bench, intent, { states: signedSteps, blocks: 5 });
  return { state, signed: bench.signed };
}

// Takes the fake bridge out of the agent's venues, as a stricter limit applies at once.
async function withoutBridgeVenue(bench: Awaited<ReturnType<typeof bridgeBench>>) {
  const settings = await bench.test.stores.agents.get(testAgent, live);
  const limits = { ...bridgeLimits, venues: ["fake-swap"] };
  const expectedVersion = settings?.limits.version ?? 0;
  const change = { agentId: testAgent, limits, atMs: testNowMs, expectedVersion };
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
});
