import { accountRefSchema, assetRefSchema } from "@binference/chain";
import type { StakingOptions, StakingVenue } from "@binference/chain/staking";
import { bpsSchema } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { stakingChains, testStakingFake, testValidator } from "../staking/test-stakes.js";
import { createStakingHost } from "./staking-host.js";

const live = { signal: new AbortController().signal };
const good: StakingOptions = {
  validators: [
    {
      validator: testValidator,
      name: "Active",
      commissionBps: bpsSchema.parse(700),
      jailed: false,
    },
  ],
  unbondingSeconds: 60,
  minStake: { asset: testCoin, base: 1n },
  readAtMs: 1,
};

async function optionsAnswering(answer: StakingOptions) {
  const venue: StakingVenue = {
    ...testStakingFake(),
    options: async () => Promise.resolve(answer),
  };
  const chains = stakingChains();
  const host = createStakingHost({ venues: [venue], chains, clock: createManualClock(1) });
  return host.options(venue, live);
}

describe("the staking host's options", () => {
  it("answers a copy of the venue's validators, unbonding time and least stake", async () => {
    expect(await optionsAnswering(good)).toStrictEqual({ ok: true, value: good });
  });

  it("is venue_down for a least stake of another asset, a validator of another chain or a bad name", async () => {
    const otherAsset = {
      ...good,
      minStake: { asset: assetRefSchema.parse("fake:1/token:0x0000000a"), base: 1n },
    };
    const [validator] = good.validators;
    const elsewhere = accountRefSchema.parse("fake:2:0x000000c1");
    const answers = await Promise.all([
      optionsAnswering(otherAsset),
      optionsAnswering({ ...good, validators: [{ ...validator, validator: elsewhere } as never] }),
      optionsAnswering({ ...good, validators: [{ ...validator, name: "bad\u0007name" } as never] }),
    ]);
    expect(answers).toStrictEqual([
      { ok: false, error: "venue_down" },
      { ok: false, error: "venue_down" },
      { ok: false, error: "venue_down" },
    ]);
  });
});
