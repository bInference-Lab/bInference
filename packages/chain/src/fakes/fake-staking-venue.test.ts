import { bpsSchema, type Result } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { stakingVenueContract } from "../contracts/staking-venue-contract.js";
import { stakePlanSchema } from "../staking/stake-plan.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeStakingVenue } from "./fake-staking-venue.js";

const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const live = { signal: new AbortController().signal };
const day = 86_400;

function successOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a success, got ${result.error}.`);
  }
  return result.value;
}

function venue() {
  return createFakeStakingVenue({
    validators: [
      { address: "0x000000c1", name: "Active", commissionBps: bpsSchema.parse(500) },
      { address: "0x000000c2", name: "Jailed", commissionBps: bpsSchema.parse(800), jailed: true },
    ],
    minStakeBase: 10n,
    unbondingSeconds: 7 * day,
    nowMs: 1_800_000_000_000,
  });
}

describe("fake staking venue", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const fake = venue();
        return await Promise.resolve({
          venue: fake,
          wallet,
          active: accountRefSchema.parse("fake:1:0x000000c1"),
          jailed: accountRefSchema.parse("fake:1:0x000000c2"),
          unknown: accountRefSchema.parse("fake:1:0x000000c9"),
          stake: { asset: coin, base: 100n },
          foreign: [
            fakeDraft(wallet, { to: "0x000000d2", value: 5n, data: "delegate,0x000000c1" }),
            fakeDraft(wallet, { to: "0x000000d1", value: 0n, data: "redelegate,0x000000c1,1" }),
            fakeDraft(wallet, { to: "0x000000d1", value: 0n, data: "claim,0x000000c1,0" }),
            fakeDraft(wallet, { to: "0x000000d1", value: 5n, data: "delegate" }),
            fakeDraft(wallet, { to: "0x000000d1", value: 5n, data: "delegate,validator" }),
          ],
          run: async (drafts) => await Promise.resolve(fake.run(drafts)),
          wait: async (seconds) => {
            fake.wait(seconds);
            await Promise.resolve();
          },
        });
      },
    }),
  )("keeps the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("plans a stake whose JSON form reads back as the same plan", async () => {
    const fake = venue();
    const validator = accountRefSchema.parse("fake:1:0x000000c1");
    const plan = await fake.plan(
      { action: "stake", wallet, validator, amount: { asset: coin, base: 50n } },
      live,
    );
    const planned = successOf(plan);
    const wire = stakePlanSchema.encode(planned);
    expect(stakePlanSchema.parse(JSON.parse(JSON.stringify(wire)))).toStrictEqual(planned);
    expect(stakePlanSchema.safeParse({ ...wire, parts: ["a"] }).success).toBe(false);
  });

  it("refuses a stake of another chain's coin as a fault", async () => {
    const validator = accountRefSchema.parse("fake:1:0x000000c1");
    const other = assetRefSchema.parse("fake:2/slip44:1");
    const ask = {
      action: "stake" as const,
      wallet,
      validator,
      amount: { asset: other, base: 50n },
    };
    await expect(venue().plan(ask, live)).rejects.toThrow(/fake chain's coin/);
  });

  it("runs only the calls it builds", () => {
    const fake = venue();
    const other = fakeDraft(wallet, {
      to: "0x000000d1",
      value: 0n,
      data: "redelegate,0x000000c1,1",
    });
    expect(() => fake.run([other])).toThrow("only the calls it builds");
  });

  it("counts in a validator's pool only the stakes made with it", async () => {
    const fake = venue();
    const active = accountRefSchema.parse("fake:1:0x000000c1");
    const jailedOne = accountRefSchema.parse("fake:1:0x000000c2");
    const stake = {
      action: "stake" as const,
      wallet,
      validator: active,
      amount: { asset: coin, base: 50n },
    };
    fake.run(await fake.build(successOf(await fake.plan(stake, live)), live));
    const receiptOf = async (validator: typeof active) =>
      successOf(await fake.receipt(validator, live));
    const receipts = [await receiptOf(active), await receiptOf(jailedOne)];
    await expect(fake.pools(receipts, live)).resolves.toEqual([
      {
        validator: active,
        pool: { shares: { asset: receipts[0], base: 50n }, coin: { asset: coin, base: 50n } },
      },
    ]);
  });
});
