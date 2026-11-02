import { assetRefSchema, chainRefSchema } from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { describe, expect, it } from "vitest";
import { expectOk, testAgent, testCoin, testWallet } from "../intents/test-intents.js";
import {
  holdStakeWallet,
  jailedValidator,
  stakeRequest,
  stakingChains,
  startStakeEngine,
  testMinStake,
  testStakingFake,
  testUnbondingSeconds,
  testValidator,
} from "../staking/test-stakes.js";
import { startTestEngine, testCall, type TestEngine } from "./test-engine.js";

const chain = chainRefSchema.parse("fake:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000c1");
const half = 5n * 10n ** 17n;

// The fake venue whose pool prices a receipt unit at one coin unit.
function pooledVenue(): StakingVenue {
  const fake = testStakingFake();
  return {
    ...fake,
    pools: async (receipts) =>
      Promise.resolve(
        receipts
          .filter((asset) => asset === receipt)
          .map(() => ({
            validator: testValidator,
            pool: { shares: { asset: receipt, base: 1n }, coin: { asset: testCoin, base: 1n } },
          })),
      ),
  };
}

async function optionsOf(test: TestEngine, args: Readonly<Record<string, unknown>>) {
  return test.engine.handlers["staking/options"](testCall({ chain, ...args }));
}

async function stakeHalf(test: TestEngine): Promise<void> {
  const { handlers } = test.engine;
  const view = expectOk(await handlers["intent/propose"](testCall(stakeRequest("stake"))));
  const card = view.card;
  if (card === undefined) {
    throw new Error("The stake has no card.");
  }
  const tap = { intent: view.intent, card: card.card, cardVersion: card.version };
  expectOk(await handlers["intent/confirm"](testCall(tap)));
}

const minAmount = { asset: testCoin, base: testMinStake };

describe("the staking options", () => {
  it("lists each validator of the venues on the chain with the unbonding time and least stake", async () => {
    const test = await startStakeEngine(pooledVenue());
    expect(expectOk(await optionsOf(test, {}))).toStrictEqual({
      items: [
        {
          venue: "fake-staking",
          validator: testValidator,
          name: "Active",
          commissionBps: 700,
          aprBps: 350,
          jailed: false,
          unbondingSeconds: testUnbondingSeconds,
          minAmount,
        },
        {
          venue: "fake-staking",
          validator: jailedValidator,
          name: "Jailed",
          commissionBps: 500,
          jailed: true,
          unbondingSeconds: testUnbondingSeconds,
          minAmount,
        },
      ],
      assets: { [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true } },
    });
  });

  it("adds the agent's stakes on the chain in its mode", async () => {
    const test = await startStakeEngine(pooledVenue());
    holdStakeWallet(test);
    await stakeHalf(test);
    const read = expectOk(await optionsOf(test, { agent: testAgent }));
    expect(read.positions).toStrictEqual([
      {
        wallet: testWallet,
        venue: "fake-staking",
        validator: testValidator,
        staked: { asset: receipt, base: half },
        stakedValue: { asset: testCoin, base: half },
        unbonding: [],
        claimable: { asset: testCoin, base: 0n },
        paper: true,
      },
    ]);
  });

  it("names only the venue asked for, and only the agent's venues", async () => {
    const test = await startStakeEngine(pooledVenue());
    expect(expectOk(await optionsOf(test, { venue: "stakehub" })).items).toStrictEqual([]);
    const outside = await startTestEngine({
      chains: stakingChains(),
      stakingVenues: [pooledVenue()],
    });
    expect(expectOk(await optionsOf(outside, { agent: testAgent })).items).toStrictEqual([]);
  });

  it("refuses an unknown chain, an unknown agent and a venue that does not answer", async () => {
    const down = { ...pooledVenue(), options: async () => Promise.reject(new Error("down")) };
    const test = await startStakeEngine(down);
    expect(await optionsOf(test, { chain: "fake:9" })).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    const stranger = "agt_0190f1c2-3a4b-7c5d-8e6f-000000000009";
    expect(await optionsOf(test, { agent: stranger })).toStrictEqual({
      ok: false,
      error: "agent.not_found",
    });
    expect(await optionsOf(test, {})).toStrictEqual({ ok: false, error: "quote.venue_down" });
  });
});
