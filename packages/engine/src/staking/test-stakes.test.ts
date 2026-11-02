import { accountRefSchema } from "@binference/chain";
import { fakeDraft, stakingVenueContract } from "@binference/chain/testing";
import { describe, expect, it } from "vitest";
import { testCoin } from "../intents/test-intents.js";
import { testAccount } from "../operations/test-engine.js";
import {
  halfCoin,
  testMinStake,
  testStakingFake,
  testValidator,
  withOwnCap,
} from "./test-stakes.js";

const live = { signal: new AbortController().signal };

describe("the engine's test staking venue", () => {
  it.each(
    stakingVenueContract({
      create: async () => {
        const fake = testStakingFake();
        return await Promise.resolve({
          venue: withOwnCap(fake),
          wallet: testAccount,
          active: accountRefSchema.parse("fake:1:0x000000c1"),
          jailed: accountRefSchema.parse("fake:1:0x000000c2"),
          unknown: accountRefSchema.parse("fake:1:0x000000c9"),
          stake: { asset: testCoin, base: testMinStake },
          foreign: [
            fakeDraft(testAccount, { to: "0x000000d2", value: 5n, data: "delegate,0x000000c1" }),
            fakeDraft(testAccount, { to: "0x000000d1", value: 0n, data: "claim,0x000000c1,0" }),
          ],
          run: async (drafts) => await Promise.resolve(fake.run(drafts)),
          wait: async (seconds) => {
            fake.wait(seconds);
            await Promise.resolve();
          },
        });
      },
    }),
  )("keeps the contract with a cap of its own: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("plans with the active validator's yearly rate it was made with", async () => {
    const ask = { action: "stake", wallet: testAccount, validator: testValidator } as const;
    const plan = await withOwnCap(testStakingFake(420)).plan({ ...ask, amount: halfCoin }, live);
    expect(plan).toMatchObject({ ok: true, value: { aprBps: 420 } });
  });
});
