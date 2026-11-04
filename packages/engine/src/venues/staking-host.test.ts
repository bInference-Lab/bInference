import { accountRefSchema, assetRefSchema, chainRefSchema, type TxHash } from "@binference/chain";
import type { StakePlan, StakeRequest, StakingVenue } from "@binference/chain/staking";
import type { FakeStakingVenue } from "@binference/chain/testing";
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

// Plans and runs the move on the fake venue as the chain would, answering its transaction hash.
async function runMove(venue: FakeStakingVenue, request: StakeRequest): Promise<TxHash> {
  const planned = await venue.plan(request, live);
  if (!planned.ok) {
    throw new Error(`The fake venue refused the test ${request.action}.`);
  }
  const [hash] = venue.run(await venue.build(planned.value, live));
  if (hash === undefined) {
    throw new Error("The fake venue landed nothing.");
  }
  return hash;
}

// A stake that landed on the fake venue, with its plan and the move the host reads back.
async function landedStake() {
  const venue = testStakingFake();
  const plan = await plannedStake();
  const hash = await runMove(venue, stake);
  const move = { action: "stake", wallet: testAccount, validator: testValidator, hash } as const;
  const read = await venue.landed(move, live);
  if (!read.ok) {
    throw new Error("The fake venue read no landed stake.");
  }
  return { venue, plan, move, read: read.value };
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

describe("the staking host's reads", () => {
  it("answers the receipt token the venue names, or its refusal", async () => {
    const venue = testStakingFake();
    const host = hostOf(venue);
    const unknown = accountRefSchema.parse("fake:1:0x000000c9");
    expect(await host.receipt(venue, testValidator, live)).toStrictEqual({
      ok: true,
      value: assetRefSchema.parse("fake:1/token:0x000000c1"),
    });
    expect(await host.receipt(venue, unknown, live)).toStrictEqual({
      ok: false,
      error: "validator_unknown",
    });
  });

  it("is venue_down for a receipt the venue throws on or names in no asset form", async () => {
    const throwing = { ...testStakingFake(), receipt: down };
    const garbled = {
      ...testStakingFake(),
      receipt: async () => Promise.resolve({ ok: true, value: "not an asset" } as never),
    };
    expect(await hostOf(throwing).receipt(throwing, testValidator, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    expect(await hostOf(garbled).receipt(garbled, testValidator, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("answers the wallet's unbonding parts with the validator, and none with another", async () => {
    const venue = testStakingFake();
    await runMove(venue, stake);
    await runMove(venue, { ...stake, action: "unstake", amount: "whole" });
    const host = hostOf(venue);
    const held = await host.parts(venue, { wallet: testAccount, validator: testValidator }, live);
    const none = await host.parts(venue, { wallet: testAccount, validator: jailedValidator }, live);
    expect(held).toMatchObject({ ok: true, value: [{ amount: two }] });
    expect(none).toStrictEqual({ ok: true, value: [] });
  });

  it("is venue_down for parts the venue throws on, or on a chain the registry does not hold", async () => {
    const throwing = { ...testStakingFake(), holdings: down };
    const away = { ...testStakingFake(), chain: elsewhere };
    const held = { wallet: testAccount, validator: testValidator };
    expect(await hostOf(throwing).parts(throwing, held, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    expect(await hostOf(away).parts(away, held, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
  });

  it("finds a venue by its id, on a chain or on every chain", () => {
    const venue = testStakingFake();
    const host = hostOf(venue);
    expect(host.venueOn(venue.id, venue.chain)).toBe(venue);
    expect(host.venueOn(venue.id, elsewhere)).toBeUndefined();
    expect(host.venuesWith(venue.id)).toStrictEqual([venue]);
    expect(host.venuesWith("other")).toStrictEqual([]);
  });
});

describe("the staking host's read-back of a landed move", () => {
  it("answers a copy of what the stake did, held to its plan", async () => {
    const { venue, plan, move } = await landedStake();
    expect(await hostOf(venue).landed(venue, { move, plan }, live)).toStrictEqual({
      ok: true,
      value: { action: "stake", validator: testValidator, moved: two, shares: plan.shares },
    });
  });

  it("is venue_down for a venue that throws, and passes not_found on", async () => {
    const { plan, move } = await landedStake();
    const throwing = { ...testStakingFake(), landed: down };
    const missing = {
      ...testStakingFake(),
      landed: async () => Promise.resolve({ ok: false, error: "not_found" } as const),
    };
    expect(await hostOf(throwing).landed(throwing, { move, plan }, live)).toStrictEqual({
      ok: false,
      error: "venue_down",
    });
    expect(await hostOf(missing).landed(missing, { move, plan }, live)).toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses a read-back of another validator as other_move", async () => {
    const { venue, plan, move, read } = await landedStake();
    const other = {
      ...venue,
      landed: async () =>
        Promise.resolve({ ok: true, value: { ...read, validator: jailedValidator } } as const),
    };
    expect(await hostOf(other).landed(other, { move, plan }, live)).toStrictEqual({
      ok: false,
      error: "decode_mismatch",
      mismatch: "other_move",
    });
  });

  it("refuses a read-back its schema cannot read, or of a chain the registry does not hold", async () => {
    const { venue, plan, move } = await landedStake();
    const garbled = {
      ...venue,
      landed: async () => Promise.resolve({ ok: true, value: { action: "stake" } } as never),
    };
    const away = { ...venue, chain: elsewhere };
    const mismatch = { ok: false, error: "decode_mismatch", mismatch: "other_move" };
    expect(await hostOf(garbled).landed(garbled, { move, plan }, live)).toStrictEqual(mismatch);
    expect(await hostOf(away).landed(away, { move, plan }, live)).toStrictEqual(mismatch);
  });
});
