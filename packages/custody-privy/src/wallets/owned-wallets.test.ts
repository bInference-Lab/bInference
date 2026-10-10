import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { testCeiling } from "../contracts/privy-custody-setup.js";
import type { PrivyApi } from "../privy/privy-api.js";
import { testAddresses } from "../testing/custody-fixtures.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import { findOwnedWallets } from "./owned-wallets.js";

const live = { signal: new AbortController().signal };

function newKey(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

// A wallet whose owner quorum holds `ownerKey` alone, under the test ceiling that quorum owns.
async function walletOwnedBy(api: PrivyApi, ownerKey: string): Promise<string> {
  const owner = await api.createKeyQuorum({ publicKey: ownerKey, displayName: "owner" }, live);
  const signer = await api.createKeyQuorum({ publicKey: newKey(), displayName: "agent" }, live);
  const policy = await api.createPolicy({ ceiling: testCeiling(), owner: owner.id }, live);
  const wallet = await api.createWallet(
    { owner: owner.id, signer: signer.id, policy: policy.id },
    live,
  );
  return wallet.id;
}

async function made() {
  const { api, ownerKey } = createFakeCustodySubject();
  const first = await walletOwnedBy(api, ownerKey);
  await walletOwnedBy(api, newKey());
  const second = await walletOwnedBy(api, ownerKey);
  return { api, ownerKey, owned: [first, second] };
}

describe("the wallets an owner key owns", () => {
  it("are the ones it owns alone, oldest first, each with its ceiling", async () => {
    const { api, ownerKey, owned } = await made();

    const found = await findOwnedWallets(api, { ownerKey }, live);

    expect(found.map((item) => item.wallet.id)).toStrictEqual(owned);
    expect(found.map((item) => item.ceiling.recipients)).toStrictEqual([
      [testAddresses.rescue, testAddresses.saved],
      [testAddresses.rescue, testAddresses.saved],
    ]);
  });

  it("are read a page at a time, following each cursor", async () => {
    const { api, ownerKey, owned } = await made();

    const found = await findOwnedWallets(api, { ownerKey, pageSize: 1 }, live);

    expect(found.map((item) => item.wallet.id)).toStrictEqual(owned);
  });

  it("are none for a key that owns nothing", async () => {
    const { api } = await made();

    expect(await findOwnedWallets(api, { ownerKey: newKey() }, live)).toStrictEqual([]);
  });
});
