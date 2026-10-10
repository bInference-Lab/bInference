import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { setUp } from "../contracts/privy-custody-setup.js";
import type { PrivyId } from "../privy/privy-records.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import { removeSigner, swapSigner } from "./signer-moves.js";

const live = { signal: new AbortController().signal };
const unknownWallet = "unknownwallet00000000000" as PrivyId;

async function made() {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const record = await subject.api.wallet(setup.wallet.id, live);
  const [policy] = record.ok ? record.value.policyIds : [];
  const [held] = record.ok ? record.value.signers : [];
  if (policy === undefined || held === undefined) {
    throw new Error("Expected the wallet's policy and signer.");
  }
  const publicKey = await subject.strangerProcess.publicKey(live);
  const quorum = await subject.api.createKeyQuorum({ publicKey, displayName: "agent" }, live);
  const input = {
    authorize: subject.ownerAuthorize,
    expiresAtMs: subject.clock.now() + 300_000,
    ...live,
  };
  return {
    subject,
    wallet: { wallet: setup.wallet.id, policy },
    old: held.signerId,
    quorum,
    input,
  };
}

describe("moving a wallet's signer", () => {
  it("swaps once, and a second swap to the same signer changes nothing more", async () => {
    const { subject, wallet, old, quorum, input } = await made();
    const target = { wallets: [wallet], signer: quorum.id };

    expect(await swapSigner(subject.api, target, input)).toStrictEqual(ok([old]));
    expect(await swapSigner(subject.api, target, input)).toStrictEqual(ok([]));
  });

  it("stops at a wallet Privy does not hold, keeping the swaps before it, and goes on again", async () => {
    const { subject, wallet, old, quorum, input } = await made();
    const missing = { wallet: unknownWallet, policy: wallet.policy };

    expect(
      await swapSigner(subject.api, { wallets: [wallet, missing], signer: quorum.id }, input),
    ).toStrictEqual(err("not_found"));
    expect(await subject.api.wallet(wallet.wallet, live)).toMatchObject(
      ok({ signers: [{ signerId: quorum.id }] }),
    );
    expect(await swapSigner(subject.api, { wallets: [wallet], signer: old }, input)).toStrictEqual(
      ok([quorum.id]),
    );
  });

  it("removes nothing when Privy does not hold one of the wallets", async () => {
    const { subject, wallet, old, input } = await made();
    const target = { wallets: [wallet.wallet, unknownWallet], signer: old };

    expect(await removeSigner(subject.api, target, input)).toStrictEqual(err("not_found"));
  });
});
