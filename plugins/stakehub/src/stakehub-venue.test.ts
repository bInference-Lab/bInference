import {
  type AccountRef,
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type StakingVenue,
} from "@binference/plugin-sdk";
import { stakingVenueContract, successOf } from "@binference/plugin-sdk/testing";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { createStakeHubVenue } from "./stakehub-venue.js";
import { foreignDrafts } from "./testing/foreign-drafts.js";
import {
  createStakeHubWorld,
  multicallAddress,
  stakeHubAddress,
  type StakeHubWorld,
} from "./testing/stake-hub-world.js";

const chain = chainRefSchema.parse("eip155:56");
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const now = 1_793_500_000n;
const day = 86_400n;
const bnb = 10n ** 18n;
const live = { signal: new AbortController().signal };
const wallet: Address = "0x1111111111111111111111111111111111110001";
const other: Address = "0x1111111111111111111111111111111111110002";
const active: Address = "0x2222222222222222222222222222222222220001";
const jailed: Address = "0x2222222222222222222222222222222222220002";
const unknown: Address = "0x2222222222222222222222222222222222220009";

const account = (address: Address): AccountRef => accountRefSchema.parse(`${chain}:${address}`);
const contracts = { "stake-hub": account(stakeHubAddress) };
const stakeOfOne = {
  action: "stake",
  wallet: account(wallet),
  validator: account(active),
  amount: { asset: coin, base: bnb },
} as const;

function testbed(): { readonly world: StakeHubWorld; readonly venue: StakingVenue } {
  const world = createStakeHubWorld(now);
  world.add({
    operator: active,
    credit: "0x3333333333333333333333333333333333330001",
    moniker: "Active",
    commissionBps: 700n,
    supply: 1_000n * bnb,
    pooled: 1_050n * bnb,
  });
  world.set(active, {
    rewards: new Map([[now / day - 1n, { reward: 1n * bnb, pooled: 10_000n * bnb }]]),
  });
  world.add({
    operator: jailed,
    credit: "0x3333333333333333333333333333333333330002",
    moniker: "Jailed",
    commissionBps: 500n,
    jailUntil: now + 2n * day,
  });
  const venue = createStakeHubVenue({
    chain,
    coin,
    rpc: world.rpc,
    contracts,
    multicall: account(multicallAddress),
  });
  return { world, venue };
}

function present<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("Expected a value.");
  }
  return value;
}

function onlyOf<T>(items: readonly T[]): T {
  const [item, ...rest] = items;
  if (item === undefined || rest.length > 0) {
    throw new Error(`Expected one item, got ${String(items.length)}.`);
  }
  return item;
}

const foreign = foreignDrafts({
  wallet: account(wallet),
  hub: stakeHubAddress,
  validator: active,
  otherValidator: jailed,
  other,
});

describe("the StakeHub venue on a StakeHub world", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const { world, venue } = testbed();
        return await Promise.resolve({
          venue,
          wallet: account(wallet),
          active: account(active),
          jailed: account(jailed),
          unknown: account(unknown),
          stake: { asset: coin, base: 3n * bnb },
          foreign,
          run: async (drafts) => await Promise.resolve(drafts.map((draft) => world.run(draft))),
          wait: async (seconds) => {
            world.wait(BigInt(seconds));
            await Promise.resolve();
          },
        });
      },
    }),
  )("keeps the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("lists each validator's commission, yearly rate and jail end from the chain", async () => {
    const { venue } = testbed();
    const options = await venue.options(live);
    expect(options.validators).toStrictEqual([
      {
        validator: account(active),
        name: "Active",
        commissionBps: 700,
        aprBps: 365,
        jailed: false,
      },
      {
        validator: account(jailed),
        name: "Jailed",
        commissionBps: 500,
        jailed: true,
        jailedUntilMs: Number((now + 2n * day) * 1_000n),
      },
    ]);
    expect([options.unbondingSeconds, options.minStake]).toStrictEqual([
      604_800,
      { asset: coin, base: bnb },
    ]);
  });

  it("takes today's rewards once StakeHub recorded them", async () => {
    const { world, venue } = testbed();
    world.set(active, {
      rewards: new Map([
        [now / day - 1n, { reward: 1n * bnb, pooled: 10_000n * bnb }],
        [now / day, { reward: 2n * bnb, pooled: 10_000n * bnb }],
      ]),
    });
    const options = await venue.options(live);
    expect(options.validators[0]?.aprBps).toBe(730);
  });

  it("plans a stake with its own validator's yearly rate, read from that validator alone", async () => {
    const { venue } = testbed();
    const plan = await venue.plan(stakeOfOne, live);
    expect(successOf(plan).aprBps).toBe(365);
  });

  it("leaves out a yearly rate above 10,000%, which no day of rewards pays", async () => {
    const { world, venue } = testbed();
    world.set(active, { rewards: new Map([[now / day, { reward: 1_000n * bnb, pooled: bnb }]]) });
    const plan = await venue.plan(stakeOfOne, live);
    expect(successOf(plan).aprBps).toBeUndefined();
  });

  it("refuses a stake to a jailed validator, and lets an unstake and a claim from one through", async () => {
    const { world, venue } = testbed();
    const ask = { wallet: account(wallet), validator: account(jailed) };
    const stake = await venue.plan(
      { ...ask, action: "stake", amount: { asset: coin, base: bnb } },
      live,
    );
    expect(stake).toStrictEqual({ ok: false, error: "validator_jailed" });
    const ready = { shares: bnb, bnbAmount: bnb, unlockTime: now - 1n };
    world.set(jailed, {
      supply: 2n * bnb,
      pooled: 2n * bnb,
      balances: new Map([[wallet, bnb]]),
      queues: new Map([[wallet, [ready]]]),
      sequences: new Map([[wallet, 1n]]),
    });
    const unstake = await venue.plan(
      { ...ask, action: "unstake", amount: { asset: coin, base: bnb } },
      live,
    );
    const claim = await venue.plan({ ...ask, action: "claim" }, live);
    expect(successOf(unstake).shares?.base).toBe(bnb);
    const ref = "0x3333333333333333333333333333333333330002:0";
    expect([successOf(claim).parts, successOf(claim).moved.base]).toStrictEqual([[ref], bnb]);
  });

  it("names StakeHub's pause and its refusal of the wallet before anything else", async () => {
    const { world, venue } = testbed();
    const ask = {
      action: "stake" as const,
      wallet: account(wallet),
      validator: account(jailed),
      amount: { asset: coin, base: 1n },
    };
    world.model.blocked.add(wallet);
    expect(await venue.plan(ask, live)).toStrictEqual({ ok: false, error: "wallet_blocked" });
    world.model.flags.paused = true;
    expect(await venue.plan(ask, live)).toStrictEqual({ ok: false, error: "staking_paused" });
  });

  it("burns the fewest shares worth at least an unstake's amount, and all of them for the whole stake", async () => {
    const { world, venue } = testbed();
    const ask = { wallet: account(wallet), validator: account(active) };
    const stake = await venue.plan(
      { ...ask, action: "stake", amount: { asset: coin, base: 7n * bnb } },
      live,
    );
    (await venue.build(successOf(stake), live)).forEach((draft) => world.run(draft));
    const held = onlyOf(await venue.holdings(account(wallet), live));
    const part = successOf(
      await venue.plan({ ...ask, action: "unstake", amount: { asset: coin, base: bnb } }, live),
    );
    const whole = successOf(
      await venue.plan({ ...ask, action: "unstake", amount: held.stakedValue }, live),
    );
    expect(part.moved.base - bnb).toBeGreaterThanOrEqual(0n);
    expect(part.moved.base - bnb).toBeLessThan(2n);
    expect(whole.shares).toStrictEqual(held.staked);
  });

  it("refuses an amount of another asset or of nothing, and a wallet of another chain, as a fault", async () => {
    const { venue } = testbed();
    const ask = { action: "stake" as const, wallet: account(wallet), validator: account(active) };
    const usdt = assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955");
    await expect(venue.plan({ ...ask, amount: { asset: usdt, base: bnb } }, live)).rejects.toThrow(
      /coin above zero/,
    );
    await expect(venue.plan({ ...ask, amount: { asset: coin, base: 0n } }, live)).rejects.toThrow(
      /coin above zero/,
    );
    const elsewhere = accountRefSchema.parse(`eip155:1:${wallet}`);
    await expect(
      venue.plan({ ...ask, wallet: elsewhere, amount: { asset: coin, base: bnb } }, live),
    ).rejects.toThrow(/StakeHub's chain/);
  });

  it("reads in a few Multicall3 batches, and rejects when no node answers", async () => {
    const { world, venue } = testbed();
    await venue.options(live);
    expect(world.calls()).toBeLessThanOrEqual(8);
    world.down();
    await expect(venue.options(live)).rejects.toThrow(/No node answers/);
  });

  it("refuses missing or foreign contracts when it is made", () => {
    const { world } = testbed();
    const make = (hub: AccountRef) => () =>
      createStakeHubVenue({
        chain,
        coin,
        rpc: world.rpc,
        contracts: { "stake-hub": hub },
        multicall: account(multicallAddress),
      });
    expect(make(accountRefSchema.parse(`eip155:1:${stakeHubAddress}`))).toThrow(/StakeHub is not/);
    expect(() =>
      createStakeHubVenue({
        chain,
        coin,
        rpc: world.rpc,
        contracts: {},
        multicall: account(multicallAddress),
      }),
    ).toThrow(/StakeHub is not/);
  });

  it("unstakes the whole stake to the last share after rewards grew it since it was read", async () => {
    const { world, venue } = testbed();
    const ask = { wallet: account(wallet), validator: account(active) };
    const stake = { ...ask, action: "stake" as const, amount: { asset: coin, base: 3n * bnb } };
    (await venue.build(successOf(await venue.plan(stake, live)), live)).forEach((draft) =>
      world.run(draft),
    );
    const before = onlyOf(await venue.holdings(account(wallet), live));
    const pool = present(world.model.validators.get(active));
    world.set(active, { pooled: pool.pooled + 5n * bnb });
    const read = { ...ask, action: "unstake" as const, amount: before.stakedValue };
    const whole = successOf(await venue.plan({ ...ask, action: "unstake", amount: "whole" }, live));
    const asRead = successOf(await venue.plan(read, live));
    expect(whole.shares).toStrictEqual(before.staked);
    expect(whole.moved.base > before.stakedValue.base).toBe(true);
    expect(present(asRead.shares).base < before.staked.base).toBe(true);
  });

  it("refuses a claim StakeHub could not pay to a wallet that holds code, after nothing to claim", async () => {
    const { world, venue } = testbed();
    const ask = { wallet: account(wallet), validator: account(active), action: "claim" as const };
    world.model.coded.add(wallet);
    expect(await venue.plan(ask, live)).toStrictEqual({ ok: false, error: "nothing_to_claim" });
    const ready = { shares: bnb, bnbAmount: bnb, unlockTime: now - 1n };
    world.set(active, { queues: new Map([[wallet, [ready]]]), sequences: new Map([[wallet, 1n]]) });
    expect(await venue.plan(ask, live)).toStrictEqual({ ok: false, error: "claim_unpayable" });
    const paper = {
      shares: 0n,
      parts: [{ ref: "paper", amount: { asset: coin, base: bnb }, readyAtMs: 0 }],
    };
    expect(successOf(await venue.plan({ ...ask, paper }, live)).parts).toStrictEqual(["paper"]);
  });

  it("reads the oldest 1,000 of a longer queue and marks the holding cut", async () => {
    const { world, venue } = testbed();
    const queue = Array.from({ length: 1_001 }, () => ({
      shares: 1n,
      bnbAmount: 1n,
      unlockTime: now - 1n,
    }));
    world.set(active, {
      queues: new Map([[wallet, queue]]),
      sequences: new Map([[wallet, 1_001n]]),
    });
    const held = onlyOf(await venue.holdings(account(wallet), live));
    const claim = await venue.plan(
      { wallet: account(wallet), validator: account(active), action: "claim" },
      live,
    );
    expect([held.unbonding.length, held.unbondingCut, held.claimable.base]).toStrictEqual([
      1_000,
      true,
      1_000n,
    ]);
    expect(held.unbonding[0]?.ref).toBe("0x3333333333333333333333333333333333330001:0");
    expect(successOf(claim).parts).toHaveLength(1_000);
  });

  it("fails as a fault, never as an unknown validator, when a listed one's description reverts", async () => {
    const { world, venue } = testbed();
    const ask = { wallet: account(wallet), validator: account(active), action: "claim" as const };
    world.model.reverting.add("getValidatorDescription");
    await expect(venue.plan(ask, live)).rejects.toThrow(/getValidatorDescription reverted/);
  });

  it("reads back a claim of two parts with their references, and nothing for a revert", async () => {
    const { world, venue } = testbed();
    const parts = [1n, 2n].map((base) => ({
      shares: base,
      bnbAmount: base * bnb,
      unlockTime: now - 1n,
    }));
    world.set(active, { queues: new Map([[wallet, parts]]), sequences: new Map([[wallet, 7n]]) });
    const ask = { wallet: account(wallet), validator: account(active) };
    const claim = successOf(await venue.plan({ ...ask, action: "claim" }, live));
    const [hash] = (await venue.build(claim, live)).map((draft) => world.run(draft));
    const landed = await venue.landed({ ...ask, action: "claim", hash: present(hash) }, live);
    const credit = "0x3333333333333333333333333333333333330001";
    expect(landed).toStrictEqual({
      ok: true,
      value: {
        action: "claim",
        validator: account(active),
        moved: { asset: coin, base: 3n * bnb },
        claimed: [`${credit}:5`, `${credit}:6`],
      },
    });
  });
});
