import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { signerRevokerContract } from "../contracts/signer-revoker-contract.js";
import { fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { createFakeSignerRevoker } from "./fake-signer-revoker.js";

describe("the fake signer revoker", () => {
  it.each(
    signerRevokerContract({
      create: async () => {
        const wallets = ["wallet-1", "wallet-2"];
        const revoker = createFakeSignerRevoker(
          new Map(wallets.map((wallet) => [wallet, ["old-signer", "new-signer"]])),
        );
        return Promise.resolve({
          revoker,
          ownerKey: createSecret(fakeOwnerKeyCode),
          otherKey: createSecret(`${fakeOwnerKeyCode}x`),
          wallets,
          signer: "old-signer",
          kept: "new-signer",
          unknownWallet: "wallet-9",
          signersOf: async (wallet: string) => Promise.resolve(revoker.signersOf(wallet)),
        });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
