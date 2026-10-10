import { generateKeyPairSync } from "node:crypto";
import { err } from "@binference/core";
import { describe, expect, it } from "vitest";
import { setUp } from "../contracts/privy-custody-setup.js";
import {
  createFakeCustodySubject,
  type FakeCustodySubject,
} from "../testing/fake-custody-subject.js";
import { addressOfKey, createTestRecipient } from "../testing/hpke-recipient.js";
import { ownerSigner } from "../testing/owner-signer.js";
import type { PrivyId } from "./privy-records.js";
import type { SealedWalletKey, WalletExportRequest } from "./wallet-export.js";

const live = { signal: new AbortController().signal };
const stranger = ownerSigner(generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey);

async function exported() {
  const subject = createFakeCustodySubject();
  const setup = await setUp(subject);
  const recipient = await createTestRecipient();
  const request = {
    wallet: setup.wallet.id,
    recipientPublicKey: recipient.publicKey,
    authorize: subject.ownerAuthorize,
    expiresAtMs: subject.clock.now() + 60_000,
  };
  return { subject, setup, recipient, request };
}

async function sealedKey(
  subject: FakeCustodySubject,
  request: WalletExportRequest,
): Promise<SealedWalletKey> {
  const sealed = await subject.api.exportWallet(request, live);
  if (!sealed.ok) {
    throw new Error("Expected the sealed key.");
  }
  return sealed.value;
}

describe("a wallet's export", () => {
  it("answers the key sealed to the recipient, which only its private half opens", async () => {
    const { subject, setup, recipient, request } = await exported();

    const sealed = await sealedKey(subject, request);
    const other = await createTestRecipient();

    const opened = await recipient.open(sealed);
    expect(addressOfKey(opened)?.toLowerCase()).toBe(setup.wallet.address.toLowerCase());
    await expect(other.open(sealed)).rejects.toThrow(/./u);
  });

  it("is refused for another key, an unknown wallet and a recipient key that is none", async () => {
    const { subject, request } = await exported();
    const exportWith = async (changed: Partial<typeof request>) =>
      subject.api.exportWallet({ ...request, ...changed }, live);

    expect(await exportWith({ authorize: stranger })).toStrictEqual(err("refused"));
    expect(await exportWith({ wallet: "nosuchwallet000000000000" as PrivyId })).toStrictEqual(
      err("not_found"),
    );
    expect(await exportWith({ recipientPublicKey: "AAAA" })).toStrictEqual(
      err("bad_recipient_key"),
    );
  });

  it("throws once its expiry has passed", async () => {
    const { subject, request } = await exported();

    await expect(
      subject.api.exportWallet({ ...request, expiresAtMs: subject.clock.now() - 1 }, live),
    ).rejects.toMatchObject({ code: "custody.request_expired" });
  });
});
