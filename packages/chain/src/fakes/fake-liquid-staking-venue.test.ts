import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { stakingVenueContract } from "../contracts/staking-venue-contract.js";
import type { StakePlanned } from "../staking/ports.js";
import type { StakePlan } from "../staking/stake-plan.js";
import type { StakeRequest } from "../staking/staking-terms.js";
import { fakeDraft } from "./fake-draft.js";
import { createFakeLiquidStakingVenue } from "./fake-liquid-staking-venue.js";

const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const pool = accountRefSchema.parse("fake:1:0x000000e1");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const receipt = assetRefSchema.parse("fake:1/token:0x000000e2");
const live = { signal: new AbortController().signal };
const day = 86_400;

function venue() {
  return createFakeLiquidStakingVenue({
    name: "Pool",
    commissionBps: bpsSchema.parse(1_000),
    minStakeBase: 10n,
    minUnstakeBase: 5n,
    unbondingSeconds: 7 * day,
    rate: { coin: 11n, units: 10n },
    nowMs: 1_800_000_000_000,
  });
}

function planOf(planned: StakePlanned): StakePlan {
  if (!planned.ok) {
    throw new Error(`The fake refused the move: ${planned.error}.`);
  }
  return planned.value;
}

async function moved(fake: ReturnType<typeof venue>, request: StakeRequest): Promise<void> {
  fake.run(await fake.build(planOf(await fake.plan(request, live)), live));
}

const stake110: StakeRequest = {
  action: "stake",
  wallet,
  validator: pool,
  amount: { asset: coin, base: 110n },
};

async function unstaked(fake: ReturnType<typeof venue>): Promise<void> {
  await moved(fake, stake110);
  await moved(fake, { action: "unstake", wallet, validator: pool, amount: "whole" });
}

describe("fake liquid staking venue", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const fake = venue();
        return await Promise.resolve({
          venue: fake,
          wallet,
          active: pool,
          unknown: accountRefSchema.parse("fake:1:0x000000c9"),
          stake: { asset: coin, base: 110n },
          foreign: [
            fakeDraft(wallet, { to: "0x000000d2", value: 5n, data: "deposit" }),
            fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "deposit" }),
            fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "claimWithdraw,0" }),
            fakeDraft(wallet, { to: "0x000000e1", value: 1n, data: "requestWithdraw,5" }),
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

  it("names a part its held queue has not released as ready after its read, and refuses its claim", async () => {
    const fake = venue();
    await unstaked(fake);
    fake.holdQueue();
    fake.wait(8 * day);
    const nowMs = 1_800_000_000_000 + 8 * day * 1_000;
    await expect(fake.holdings(wallet, live)).resolves.toMatchObject([
      { unbonding: [{ ref: "1", readyAtMs: nowMs + 1, queued: true }], claimable: { base: 0n } },
    ]);
    await expect(fake.plan({ action: "claim", wallet, validator: pool }, live)).resolves.toEqual({
      ok: false,
      error: "nothing_to_claim",
      facts: { readyAtMs: nowMs + 1 },
    });
    fake.releaseQueue();
    await expect(
      fake.plan({ action: "claim", wallet, validator: pool }, live),
    ).resolves.toMatchObject({ ok: true, value: { parts: ["1"] } });
  });

  it("refuses every move while paused, and an unstake under its least", async () => {
    const fake = venue();
    await moved(fake, stake110);
    const small = { asset: receipt, base: 1n };
    fake.pause();
    const paused = await fake.plan({ action: "claim", wallet, validator: pool }, live);
    fake.unpause();
    const tiny = await fake.plan(
      { action: "unstake", wallet, validator: pool, amount: small },
      live,
    );
    expect(paused).toEqual({ ok: false, error: "staking_paused" });
    expect(tiny).toEqual({
      ok: false,
      error: "below_min_stake",
      facts: { minStake: { asset: coin, base: 5n } },
    });
  });

  it("claims the soonest part first and names when the next is ready", async () => {
    const fake = venue();
    await unstaked(fake);
    fake.wait(day);
    await moved(fake, stake110);
    await moved(fake, { action: "unstake", wallet, validator: pool, amount: "whole" });
    const firstReadyMs = 1_800_000_000_000 + 7 * day * 1_000;
    await expect(fake.plan({ action: "claim", wallet, validator: pool }, live)).resolves.toEqual({
      ok: false,
      error: "nothing_to_claim",
      facts: { readyAtMs: firstReadyMs },
    });
    fake.wait(7 * day);
    await expect(
      fake.plan({ action: "claim", wallet, validator: pool }, live),
    ).resolves.toMatchObject({ ok: true, value: { parts: ["1"] } });
  });

  it("names request 0 in a paper claim's call, which reads only the paper position", async () => {
    const fake = venue();
    const part = { ref: "paper-1", amount: { asset: coin, base: 9n }, readyAtMs: 0 };
    const paper = { shares: 0n, parts: [part] };
    const planned = await fake.plan({ action: "claim", wallet, validator: pool, paper }, live);
    expect(planned).toMatchObject({ ok: true, value: { parts: ["paper-1"], paper: true } });
    const drafts = await fake.build(planOf(planned), live);
    expect(drafts.map((draft) => draft.payload)).toEqual(["0x000000e1|0|claimWithdrawByUUID,0"]);
  });

  it("names its pool only once a stake minted receipt units", async () => {
    const fake = venue();
    await expect(fake.pools([receipt], live)).resolves.toEqual([]);
    await moved(fake, stake110);
    await expect(fake.pools([receipt], live)).resolves.toEqual([
      {
        validator: pool,
        pool: { shares: { asset: receipt, base: 100n }, coin: { asset: coin, base: 110n } },
      },
    ]);
  });

  it("runs no call while paused, and only the calls it builds", async () => {
    const fake = venue();
    const deposit = fakeDraft(wallet, { to: "0x000000e1", value: 110n, data: "deposit" });
    fake.pause();
    expect(() => fake.run([deposit])).toThrow("paused");
    fake.unpause();
    const foreign = fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "mint" });
    expect(() => fake.run([foreign])).toThrow("only the calls it builds");
  });

  it("pulls only receipt units the wallet holds and approved", async () => {
    const fake = venue();
    await moved(fake, stake110);
    const request = fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "requestWithdraw,100" });
    expect(() => fake.run([request])).toThrow("holds and approved");
  });

  it("claims only a released request, whether for the wallet or for a bot", async () => {
    const fake = venue();
    await unstaked(fake);
    const claim = fakeDraft(wallet, { to: "0x000000e1", value: 0n, data: "claimWithdrawByUUID,1" });
    expect(() => fake.run([claim])).toThrow("only a released request");
    expect(() => {
      fake.claimFor(wallet, "1");
    }).toThrow("only a released request");
  });

  it("refuses a request for another asset or off the fake chain", async () => {
    const fake = venue();
    const other = accountRefSchema.parse("eip155:1:0x00000000000000000000000000000000000000a1");
    const wrongAsset = { ...stake110, amount: { asset: receipt, base: 110n } };
    await expect(fake.plan(wrongAsset, live)).rejects.toThrow("stakes the coin");
    await expect(fake.plan({ ...stake110, wallet: other }, live)).rejects.toThrow(
      "stakes the coin",
    );
  });
});
