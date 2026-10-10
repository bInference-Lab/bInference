import type { PrivyRequest } from "@binference/chain";
import { ok } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { buildCeiling, createPrivyApi, isPrivyId, type PrivyApi } from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCeilingRequest,
} from "@binference/custody-privy/testing";
import { signerRevokerContract } from "@binference/engine/testing";
import {
  createP256KeyPair,
  formatOwnerKeyCode,
  type P256KeyPair,
  signAuthorization,
} from "@binference/signer";
import { describe, expect, it } from "vitest";
import { createPrivySignerRevoker } from "./privy-signer-revoker.js";

const live = { signal: new AbortController().signal };

async function quorumOf(api: PrivyApi, key: P256KeyPair, displayName: string) {
  return api.createKeyQuorum({ publicKey: key.publicKey, displayName }, live);
}

// Two wallets on the fake Privy owned by the owner key, each with two agent keys as its signers.
async function subject() {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(11) });
  const api = createPrivyApi({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const owner = createP256KeyPair();
  const ownerQuorum = await quorumOf(api, owner, "owner");
  const [old, kept] = [
    await quorumOf(api, createP256KeyPair(), "old agent"),
    await quorumOf(api, createP256KeyPair(), "new agent"),
  ];
  const ceiling = buildCeiling({
    ...testCeilingRequest(),
    rescue: testAddresses.rescue,
    saved: [],
  });
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  const policy = await api.createPolicy({ ceiling: ceiling.value, owner: ownerQuorum.id }, live);
  const wallets = await Promise.all(
    [1, 2].map(async () =>
      api.createWallet({ owner: ownerQuorum.id, signer: old.id, policy: policy.id }, live),
    ),
  );
  const both = [old.id, kept.id].map((id) => ({ signer: id, policies: [policy.id] }));
  const authorize = async (request: PrivyRequest) =>
    Promise.resolve(ok(signAuthorization(owner.privateKey, request)));
  for (const wallet of wallets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wallet at a time
    await api.setSigners(
      { wallet: wallet.id, signers: both, expiresAtMs: clock.now() + 60_000 },
      { authorize, ...live },
    );
  }
  return {
    revoker: createPrivySignerRevoker({
      api,
      clock,
      ownerKeyPublic: async () => Promise.resolve(owner.publicKey),
    }),
    ownerKey: formatOwnerKeyCode(owner),
    otherKey: formatOwnerKeyCode(createP256KeyPair()),
    wallets: wallets.map((wallet) => wallet.id),
    signer: old.id,
    kept: kept.id,
    unknownWallet: "nosuchwallet000000000000",
    signersOf: async (wallet: string) => {
      const record = isPrivyId(wallet) ? await api.wallet(wallet, live) : undefined;
      return record?.ok === true ? record.value.signers.map((item) => item.signerId) : [];
    },
  };
}

describe("the Privy signer revoker", () => {
  it.each(signerRevokerContract({ create: subject }))(
    "follows the signer revoker contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
