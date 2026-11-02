import { bpsSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { stakingVenueContract } from "../contracts/staking-venue-contract.js";
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

async function moved(fake: ReturnType<typeof venue>, request: StakeRequest): Promise<void> {
  const planned = await fake.plan(request, live);
  if (!planned.ok) {
    throw new Error(`The fake refused a ${request.action}: ${planned.error}.`);
  }
  fake.run(await fake.build(planned.value, live));
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
});
