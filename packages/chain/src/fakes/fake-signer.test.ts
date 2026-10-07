import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { accountRefSchema } from "../caip/account-ref.js";
import { chainRefSchema } from "../caip/chain-ref.js";
import { signerContract } from "../contracts/signer-contract.js";
import type { SignRequest } from "../sign-request.js";
import type { UnsignedTx } from "../transaction.js";
import { createFakeSigner } from "./fake-signer.js";
import { createFakeSigningScheme } from "./fake-signing-scheme.js";

const wallet = "wal_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"wal">;
const unknownWallet = "wal_0190f1c2-3b4c-7d5e-8f60-718293a4b5c7" as Id<"wal">;
const account = accountRefSchema.parse("fake:1:0x0000000a");
const tx: UnsignedTx = { chain: chainRefSchema.parse("fake:1"), from: account, payload: "send|1" };
const request: SignRequest = {
  wallet,
  intent: "int_0190f1c2-3b4c-7d5e-8f60-718293a4b5c6" as Id<"int">,
  step: 0,
  authorization: { approvalMode: "auto", modeVersion: 3 },
  termsHash: "0".repeat(64),
  allowed: [],
  tx,
};
const live = { signal: new AbortController().signal };

describe("fake signer", () => {
  it.each(
    signerContract({
      create: () => ({
        signer: createFakeSigner(new Map([[wallet, account]])),
        scheme: createFakeSigningScheme(),
        wallet,
        account,
        otherChain: chainRefSchema.parse("fake:2"),
        unknownWallet,
        tx,
        foreignTx: { ...tx, from: accountRefSchema.parse("fake:1:0x0000000b") },
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses a wallet once its owner removed the signer, and only that wallet", async () => {
    const other = "wal_0190f1c2-3b4c-7d5e-8f60-718293a4b5c8" as Id<"wal">;
    const signer = createFakeSigner(
      new Map([
        [wallet, account],
        [other, account],
      ]),
    );
    signer.removeFrom(wallet);
    await expect(signer.signTransaction(request, live)).resolves.toStrictEqual({
      ok: false,
      error: "refused",
    });
    await expect(
      signer.signTransaction({ ...request, wallet: other }, live),
    ).resolves.toMatchObject({ ok: true });
  });
});
