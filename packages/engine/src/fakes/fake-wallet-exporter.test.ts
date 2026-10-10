import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { walletExporterContract } from "../contracts/wallet-exporter-contract.js";
import { fakeOwnerKeyCode } from "./fake-ceiling-editor.js";
import { createFakeWalletExporter, fakeRecipient } from "./fake-wallet-exporter.js";

const key = `0x${"ab".repeat(32)}`;

describe("the fake wallet exporter", () => {
  it.each(
    walletExporterContract({
      create: async () => {
        let recipients = 0;
        return Promise.resolve({
          exporter: createFakeWalletExporter({ keys: new Map([["fake-wallet-1", key]]) }),
          ownerKey: createSecret(fakeOwnerKeyCode),
          otherKey: createSecret("bnok1aaaaa bbbbb ccccc ddddd eeeee"),
          wallet: "fake-wallet-1",
          unknownWallet: "fake-wallet-9",
          isWalletKey: (text) => text === key,
          recipient: async () => {
            recipients += 1;
            return fakeRecipient(recipients);
          },
        });
      },
    }),
  )("follows the wallet exporter contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
