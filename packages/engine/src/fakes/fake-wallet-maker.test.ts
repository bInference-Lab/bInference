import { type AccountRef, accountRefSchema, chainRefSchema } from "@binference/chain";
import { createSecret } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { walletMakerContract } from "../contracts/wallet-maker-contract.js";
import { fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { createFakeWalletMaker } from "./fake-wallet-maker.js";

const recipients = [
  accountRefSchema.parse("fake:1:0x000000a1"),
  accountRefSchema.parse("fake:1:0x000000f1"),
] as const;

function listed(held: readonly AccountRef[] | undefined): readonly AccountRef[] {
  return held ?? [];
}

describe("the fake wallet maker", () => {
  it.each(
    walletMakerContract({
      create: async () => {
        const maker = createFakeWalletMaker({
          clock: createManualClock(1_800_000_000_000),
          chain: chainRefSchema.parse("fake:1"),
          family: "fake",
        });
        const next = { n: 0 };
        return Promise.resolve({
          maker,
          ownerKey: createSecret(fakeOwnerKeyCode),
          otherKey: createSecret("bnok1aaaaa bbbbb ccccc ddddd eeeee"),
          venues: ["fake-venue"],
          recipients,
          nextWallet: () => fixtureId("wal", (next.n += 1)),
          recipientsOf: async (made) =>
            Promise.resolve(listed(maker.recipients(made.record.policyId))),
          isLaunchCeiling: async (made) =>
            Promise.resolve(JSON.stringify(made.record.ceiling.policy).includes('"isLaunch":true')),
          made: () => maker.count(),
        });
      },
    }),
  )("follows the wallet maker contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
