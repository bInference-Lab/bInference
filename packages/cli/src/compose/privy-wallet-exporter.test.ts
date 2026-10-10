import { createManualClock, createSeededRandom } from "@binference/core/testing";
import { buildCeiling, createPrivyApi, type PrivyApi } from "@binference/custody-privy";
import {
  createFakePrivy,
  testAddresses,
  testCeilingRequest,
} from "@binference/custody-privy/testing";
import { type ExportRecipient, walletExporterContract } from "@binference/engine/testing";
import { createP256KeyPair, formatOwnerKeyCode, type P256KeyPair } from "@binference/signer";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { createKeyRecipient } from "../export/key-recipient.js";
import { createPrivyWalletExporter } from "./privy-wallet-exporter.js";

const live = { signal: new AbortController().signal };

function isHexKey(text: string): text is `0x${string}` {
  return /^0x[0-9a-f]{64}$/u.test(text);
}

async function recipient(): Promise<ExportRecipient> {
  const made = await createKeyRecipient();
  return {
    publicKey: made.publicKey,
    open: async (sealed) => new TextDecoder().decode(await made.open(sealed)),
  };
}

// A wallet on the fake Privy owned by the owner key, under the test ceiling.
async function ownedWallet(api: PrivyApi, owner: P256KeyPair) {
  const quorum = await api.createKeyQuorum(
    { publicKey: owner.publicKey, displayName: "owner" },
    live,
  );
  const signer = await api.createKeyQuorum(
    { publicKey: createP256KeyPair().publicKey, displayName: "agent" },
    live,
  );
  const ceiling = buildCeiling({
    ...testCeilingRequest(),
    rescue: testAddresses.rescue,
    saved: [],
  });
  if (!ceiling.ok) {
    throw new Error("Expected the test ceiling.");
  }
  const policy = await api.createPolicy({ ceiling: ceiling.value, owner: quorum.id }, live);
  return api.createWallet({ owner: quorum.id, signer: signer.id, policy: policy.id }, live);
}

async function subject() {
  const clock = createManualClock(1_790_000_000_000);
  const privy = createFakePrivy({ clock, random: createSeededRandom(9) });
  const api = createPrivyApi({
    http: privy.http,
    clock,
    appId: privy.appId,
    appSecret: privy.appSecret,
  });
  const owner = createP256KeyPair();
  const wallet = await ownedWallet(api, owner);
  const exporter = createPrivyWalletExporter({
    api,
    clock,
    ownerKeyPublic: async () => Promise.resolve(owner.publicKey),
  });
  return {
    exporter,
    ownerKey: formatOwnerKeyCode(owner),
    otherKey: formatOwnerKeyCode(createP256KeyPair()),
    wallet: wallet.id,
    unknownWallet: "nosuchwallet000000000000",
    isWalletKey: (text: string) =>
      isHexKey(text) && privateKeyToAddress(text).toLowerCase() === wallet.address.toLowerCase(),
    recipient,
  };
}

describe("the Privy wallet exporter", () => {
  it.each(walletExporterContract({ create: subject }))(
    "follows the wallet exporter contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
