import { chainRefSchema } from "@binference/chain";
import type { StakePlan, StakeRequest, StakingVenue } from "@binference/chain/staking";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import {
  jailedValidator,
  stakingChains,
  testMinStake,
  testStakingFake,
  testValidator,
} from "../staking/test-stakes.js";
import { createStakingHost } from "./staking-host.js";

const live = { signal: new AbortController().signal };
const two = { asset: testCoin, base: 2n * 10n ** 18n };
const stake: StakeRequest = {
  action: "stake",
  wallet: testAccount,
  validator: testValidator,
  amount: two,
};
const elsewhere = chainRefSchema.parse("fake:9");

function hostOf(venue: StakingVenue) {
  return createStakingHost({
    venues: [venue],
    chains: stakingChains(),
    clock: createManualClock(1_800_000_000_000),
  });
}

async function plannedStake(): Promise<StakePlan> {
  const planned = await testStakingFake().plan(stake, live);
  if (!planned.ok) {
    throw new Error("The fake venue refused the test stake.");
  }
  return planned.value;
}

const down = async (): Promise<never> => Promise.reject(new Error("down"));

describe("the staking host's plan", () => {
  it("answers a copy of the venue's plan of the move asked", async () => {
    const venue = testStakingFake();
    const planned = await hostOf(venue).plan(venue, stake, live);
    expect(planned).toStrictEqual({ ok: true, value: await plannedStake() });
  });

  it("is venue_down for a venue that throws", async () => {
    const venue = { ...testStakingFake(), plan: down };
    expect(await hostOf(venue).plan(venue, stake, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("passes the venue's refusal on with the facts its words name", async () => {
    const venue = testStakingFake();
    const small = { ...stake, amount: { asset: testCoin, base: 1n } };
    expect(await hostOf(venue).plan(venue, small, live)).toStrictEqual({
      ok: false,
      error: "below_min_stake",
      facts: { minStake: { asset: testCoin, base: testMinStake } },
    });
  });

  it("passes a refusal with no facts on bare", async () => {
    const venue = testStakingFake();
    const jailed = { ...stake, validator: jailedValidator };
    expect(await hostOf(venue).plan(venue, jailed, live)).toStrictEqual({
      ok: false,
      error: "validator_jailed",
    });
  });

  it("leaves out refusal facts that do not read as facts", async () => {
    const venue = {
      ...testStakingFake(),
      plan: async () =>
        Promise.resolve({
          ok: false,
          error: "nothing_to_claim",
          facts: { readyAtMs: -1 },
        } as const),
    };
    expect(await hostOf(venue).plan(venue, stake, live)).toStrictEqual({
      ok: false,
      error: "nothing_to_claim",
    });
  });

  it("refuses a plan of another validator as other_plan", async () => {
    const plan = { ...(await plannedStake()), validator: jailedValidator };
    const venue = {
      ...testStakingFake(),
      plan: async () => Promise.resolve({ ok: true, value: plan } as const),
    };
    expect(await hostOf(venue).plan(venue, stake, live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_plan",
    });
  });

  it("refuses a plan its schema cannot read, such as a validator name with a control character", async () => {
    const plan = { ...(await plannedStake()), validatorName: "Active\u0007" };
    const venue = {
      ...testStakingFake(),
      plan: async () => Promise.resolve({ ok: true, value: plan } as const),
    };
    expect(await hostOf(venue).plan(venue, stake, live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_plan",
    });
  });

  it("refuses a plan of a venue on a chain the registry does not hold", async () => {
    const venue = { ...testStakingFake(), chain: elsewhere };
    expect(await hostOf(venue).plan(venue, stake, live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_plan",
    });
  });
});

describe("the staking host's build", () => {
  it("answers the venue's call held to the plan", async () => {
    const venue = testStakingFake();
    const plan = await plannedStake();
    const built = await hostOf(venue).build(venue, plan, live);
    expect(built).toStrictEqual({ ok: true, value: await venue.build(plan, live) });
  });

  it("is venue_down for a venue that throws", async () => {
    const venue = { ...testStakingFake(), build: down };
    expect(await hostOf(venue).build(venue, await plannedStake(), live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("refuses a call whose decoder throws as unreadable_step", async () => {
    const venue = {
      ...testStakingFake(),
      decode: () => {
        throw new Error("unreadable");
      },
    };
    expect(await hostOf(venue).build(venue, await plannedStake(), live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "unreadable_step",
    });
  });

  it("refuses a call its own decoder does not read as unreadable_step", async () => {
    const venue = {
      ...testStakingFake(),
      decode: () => ({ ok: false, error: "unknown_call" }) as const,
    };
    expect(await hostOf(venue).build(venue, await plannedStake(), live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "unreadable_step",
    });
  });

  it("refuses a call of a venue on a chain the registry does not hold as unreadable_step", async () => {
    const venue = { ...testStakingFake(), chain: elsewhere };
    expect(await hostOf(venue).build(venue, await plannedStake(), live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "unreadable_step",
    });
  });

  it("refuses a call that makes another move than the plan as other_stake", async () => {
    const venue = testStakingFake();
    const plan = await plannedStake();
    const smaller = { ...plan, value: { ...plan.value, base: testMinStake } };
    const other = { ...venue, build: async () => venue.build(smaller, live) };
    const built = await hostOf(other).build(other, plan, live);
    expect(built).toStrictEqual({ ok: false, error: "decode_mismatch", mismatch: "other_stake" });
  });
});
