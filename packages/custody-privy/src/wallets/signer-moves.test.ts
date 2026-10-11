import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { setUp, testCeiling } from "../contracts/privy-custody-setup.js";
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
    expiry: () => subject.clock.now() + 300_000,
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

// Another wallet of the same owner key, with the ceiling its signer is bound to.
async function secondWallet(subject: ReturnType<typeof createFakeCustodySubject>) {
  const { api, ownerKey } = subject;
  const owner = await api.createKeyQuorum({ publicKey: ownerKey, displayName: "owner" }, live);
  const publicKey = await subject.signerProcess.publicKey(live);
  const signer = await api.createKeyQuorum({ publicKey, displayName: "agent" }, live);
  const policy = await api.createPolicy({ ceiling: testCeiling(), owner: owner.id }, live);
  const wallet = await api.createWallet(
    { owner: owner.id, signer: signer.id, policy: policy.id },
    live,
  );
  return { wallet: wallet.id, policy: policy.id };
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

  it("signs each wallet's change with an expiry of its own", async () => {
    const { subject, wallet, quorum, input } = await made();
    const wallets = [wallet, await secondWallet(subject)];
    const expiries: number[] = [];
    const counted = {
      ...input,
      expiry: () => {
        expiries.push(input.expiry());
        return input.expiry();
      },
    };

    const swapped = await swapSigner(subject.api, { wallets, signer: quorum.id }, counted);

    expect(swapped.ok).toBe(true);
    expect(expiries).toHaveLength(2);
  });

  it("reports a change Privy read after its expiry as expired, not as a wrong key", async () => {
    const { subject, wallet, old, quorum, input } = await made();
    const late = { ...input, expiry: () => subject.clock.now() - 1 };

    expect(
      await swapSigner(subject.api, { wallets: [wallet], signer: quorum.id }, late),
    ).toStrictEqual(err("expired"));
    expect(await subject.api.wallet(wallet.wallet, live)).toMatchObject(
      ok({ signers: [{ signerId: old }] }),
    );
  });

  it("removes nothing when Privy does not hold one of the wallets", async () => {
    const { subject, wallet, old, input } = await made();
    const target = { wallets: [wallet.wallet, unknownWallet], signer: old };

    expect(await removeSigner(subject.api, target, input)).toStrictEqual(err("not_found"));
  });
});
