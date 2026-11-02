import { accountRefSchema, type TxDraft, type TxHash } from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { fakeDraft, type FakeStakingVenue, stakingVenueContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import { testMinStake, testStakingFake } from "../staking/test-stakes.js";
import { landing, refusable } from "./test-stake-bench.js";

interface Wrapped {
  readonly venue: StakingVenue;
  readonly run: (drafts: readonly TxDraft[]) => readonly TxHash[];
}

// The contract's harness over a wrapper of the fake venue and the way it runs drafts.
function harnessOf(wrap: (fake: FakeStakingVenue) => Wrapped) {
  return {
    create: async () => {
      const fake = testStakingFake();
      const { venue, run } = wrap(fake);
      return await Promise.resolve({
        venue,
        wallet: testAccount,
        active: accountRefSchema.parse("fake:1:0x000000c1"),
        jailed: accountRefSchema.parse("fake:1:0x000000c2"),
        unknown: accountRefSchema.parse("fake:1:0x000000c9"),
        stake: { asset: testCoin, base: testMinStake },
        foreign: [
          fakeDraft(testAccount, { to: "0x000000d2", value: 5n, data: "delegate,0x000000c1" }),
        ],
        run: async (drafts: readonly TxDraft[]) => await Promise.resolve(run(drafts)),
        wait: async (seconds: number) => {
          fake.wait(seconds);
          await Promise.resolve();
        },
      });
    },
  };
}

const answering = harnessOf((fake) => ({
  venue: refusable(fake).venue,
  run: (drafts) => fake.run(drafts),
}));

const landed = harnessOf((fake) => {
  const venue = landing(fake);
  return { venue, run: venue.run };
});

describe("the executor bench's staking venues (decision 0327)", () => {
  it.each(stakingVenueContract(answering))(
    "keep the contract while they answer as the venue: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );

  it.each(stakingVenueContract(landed))(
    "keep the contract when the bench's chain lands their moves: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
