import { type AssetRef, createChainRegistry, type SimulationOptions } from "@binference/chain";
import {
  createFakeChainDefinition,
  createFakeFamily,
  createFakeSigningScheme,
} from "@binference/chain/testing";
import { bpsSchema, err, type Id, ok, type Result } from "@binference/core";
import type { SimulationView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import type { BuiltQuote } from "../confirmations/stored-intent.js";
import { simulatorContract } from "../contracts/simulator-contract.js";
import { createFakeSimulator } from "../fakes/fake-simulator.js";
import { createMemoryEngineStores } from "../fakes/memory-engine-stores.js";
import type { SimulationFailure } from "../intents/intent-reason.js";
import { testAgent, testCoin, testNowMs, testToken, testWallet } from "../intents/test-intents.js";
import type { Simulator } from "../ports.js";
import type { PaperPortfolio } from "./paper-portfolio.js";
import { withPaperSimulation } from "./paper-simulation.js";

const live = { signal: new AbortController().signal };
const paperIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000001" as Id<"int">;
const liveIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000002" as Id<"int">;
const unknownIntent = "int_0190f1c2-3a4b-7c5d-8e6f-000000000003" as Id<"int">;
const chains = createChainRegistry({
  chains: [createFakeChainDefinition()],
  families: [createFakeFamily()],
  signingSchemes: [createFakeSigningScheme()],
});
// The test wallet holds 5 of the fake chain's coin and 9 of the token on paper.
const portfolio: PaperPortfolio = {
  balance: async (wallet, asset) => {
    const held = new Map([
      [testCoin, 5n],
      [testToken, 9n],
    ]);
    return await Promise.resolve(wallet === testWallet ? (held.get(asset) ?? 0n) : 0n);
  },
  reset: async () => await Promise.reject(new Error("Not reset here.")),
};
const simulated = { spent: [], received: [], simulatedAt: testNowMs };

function built(spent: AssetRef): BuiltQuote {
  const amount = (base: bigint) => ({ asset: spent, base });
  return {
    quote: {
      route: [{ venue: "fake-swap", shareBps: bpsSchema.parse(10_000) }],
      amountIn: amount(1n),
      expectedOut: amount(1n),
      minOut: amount(1n),
      priceImpactBps: bpsSchema.parse(10),
      gas: { asset: testCoin, base: 0n },
      quotedAt: testNowMs - 1_000,
      expiresAt: testNowMs + 59_000,
    },
    steps: [],
  };
}

// A store that holds a paper intent and a live one.
async function seededStores() {
  const stores = createMemoryEngineStores();
  const draft = {
    agentId: testAgent,
    walletId: testWallet,
    kind: "swap",
    state: "proposed",
    request: {},
    hasOutsideContent: false,
    proposer: "engine",
    atMs: testNowMs,
    cause: { trigger: "propose" },
  } as const;
  await stores.intents.create({ ...draft, id: paperIntent, isPaper: true }, live);
  await stores.intents.create({ ...draft, id: liveIntent, isPaper: false }, live);
  return stores;
}

async function setup() {
  const stores = await seededStores();
  const seen: SimulationOptions[] = [];
  const recording: Simulator = {
    simulate: async (_intent, _built, options) => {
      seen.push(options);
      return await Promise.resolve(ok({ ...simulated, gasUsed: 0n }));
    },
  };
  const simulator = withPaperSimulation(recording, { portfolio, intents: stores.intents, chains });
  return { simulator, seen };
}

// The paper intent's steps match their terms and the live one's differ, as the inner simulator
// answers by intent.
const contractStores = await seededStores();
const moved = {
  spent: [{ asset: testToken, base: 1n }],
  received: [{ asset: testCoin, base: 1n }],
  simulatedAt: testNowMs,
};
const answers = new Map<Id<"int">, Result<SimulationView, SimulationFailure>>([
  [paperIntent, ok(moved)],
  [liveIntent, err("effects_differ")],
]);

describe("simulation with paper balances", () => {
  it.each(
    simulatorContract({
      create: () => ({
        simulator: withPaperSimulation(createFakeSimulator(answers), {
          portfolio,
          intents: contractStores.intents,
          chains,
        }),
        matching: { intent: paperIntent, built: built(testToken) },
        differing: { intent: liveIntent, built: built(testToken) },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("runs a paper trade with the paper balances of the chain's coin and the asset it spends", async () => {
    const { simulator, seen } = await setup();
    await expect(simulator.simulate(paperIntent, built(testToken), live)).resolves.toStrictEqual(
      ok({ ...simulated, gasUsed: 0n }),
    );
    expect(seen.map((options) => options.balances)).toStrictEqual([
      [
        { asset: testCoin, base: 5n },
        { asset: testToken, base: 9n },
      ],
    ]);
  });

  it("gives a paper trade that spends the coin its balance once", async () => {
    const { simulator, seen } = await setup();
    await simulator.simulate(paperIntent, built(testCoin), live);
    expect(seen.map((options) => options.balances)).toStrictEqual([
      [{ asset: testCoin, base: 5n }],
    ]);
  });

  it.each([
    ["a live intent", liveIntent],
    ["an intent the store does not hold", unknownIntent],
  ])("runs %s on the chain's balances", async (_case, intent) => {
    const { simulator, seen } = await setup();
    await simulator.simulate(intent, built(testToken), live);
    expect(seen).toStrictEqual([live]);
  });
});
