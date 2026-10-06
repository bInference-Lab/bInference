import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { DeviceRecord } from "../access/device-record.js";
import type { TokenRecord } from "../access/token-record.js";
import type { AccessStore } from "../ports.js";
import { assertRefusesAborted, checkOn, fixtureHash, fixtureId, live } from "./store-fixtures.js";

/** Makes a fresh, empty access store for each check. */
export interface AccessStoreHarness {
  create(): Promise<AccessStore>;
}

function token(n: number): TokenRecord {
  return {
    id: fixtureId("tok", n),
    label: `token ${String(n)}`,
    kind: "mcp",
    scopes: ["read", "propose"],
    secretHash: fixtureHash(`bnt_secret_${String(n)}`),
    createdAtMs: 1_000,
  };
}

function device(n: number): DeviceRecord {
  return {
    id: fixtureId("dev", n),
    label: `laptop ${String(n)}`,
    alg: "p256",
    publicKey: `BPublicKey${String(n)}`,
    createdAtMs: 1_000 + n,
  };
}

async function keepsTokens(store: AccessStore): Promise<void> {
  assert.deepEqual(await store.addToken(token(2), live()), { ok: true, value: token(2) });
  await store.addToken(token(3), live());
  await store.addToken(token(1), live());
  assert.deepEqual(await store.findToken(token(2).secretHash, live()), token(2));
  assert.equal(await store.findToken(fixtureHash("unknown"), live()), undefined);
  assert.deepEqual(await store.listTokens(live()), [token(1), token(2), token(3)]);
  const sameId = { ...token(1), secretHash: fixtureHash("other") };
  const sameSecret = { ...token(4), secretHash: token(1).secretHash };
  assert.deepEqual(await store.addToken(sameId, live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.addToken(sameSecret, live()), { ok: false, error: "exists" });
  assert.equal((await store.listTokens(live())).length, 3);
}

async function stampsTokens(store: AccessStore): Promise<void> {
  const id = token(1).id;
  await store.addToken(token(1), live());
  await store.markTokenUsed({ id, atMs: 5_000 }, live());
  const older = await store.markTokenUsed({ id, atMs: 4_000 }, live());
  assert.deepEqual(older, { ok: true, value: { ...token(1), lastUsedAtMs: 5_000 } });
  await store.revokeToken({ id, atMs: 6_000 }, live());
  const again = await store.revokeToken({ id, atMs: 7_000 }, live());
  const revoked = { ...token(1), lastUsedAtMs: 5_000, revokedAtMs: 6_000 };
  assert.deepEqual(again, { ok: true, value: revoked });
  assert.deepEqual(await store.findToken(token(1).secretHash, live()), revoked);
  const unknown = { id: token(9).id, atMs: 1 };
  assert.deepEqual(await store.markTokenUsed(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.revokeToken(unknown, live()), { ok: false, error: "not_found" });
}

async function keepsDevices(store: AccessStore): Promise<void> {
  await store.addDevice(device(2), live());
  assert.deepEqual(await store.addDevice(device(1), live()), { ok: true, value: device(1) });
  assert.deepEqual(await store.addDevice(device(1), live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.listDevices(live()), [device(1), device(2)]);
  const id = device(1).id;
  await store.markDeviceSeen({ id, atMs: 5_000 }, live());
  await store.markDeviceSeen({ id, atMs: 4_000 }, live());
  await store.revokeDevice({ id, atMs: 6_000 }, live());
  await store.revokeDevice({ id, atMs: 7_000 }, live());
  const revoked = { ...device(1), lastSeenAtMs: 5_000, revokedAtMs: 6_000 };
  assert.deepEqual(await store.findDevice(id, live()), revoked);
  assert.equal(await store.findDevice(device(9).id, live()), undefined);
  const unknown = { id: device(9).id, atMs: 1 };
  assert.deepEqual(await store.markDeviceSeen(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.revokeDevice(unknown, live()), { ok: false, error: "not_found" });
}

async function usesCodesOnce(store: AccessStore): Promise<void> {
  const code = { codeHash: fixtureHash("482913"), expiresAtMs: 10_000 };
  const late = { codeHash: fixtureHash("771205"), expiresAtMs: 10_000 };
  assert.deepEqual(await store.addPairCode(code, live()), { ok: true, value: code });
  assert.deepEqual(await store.addPairCode(code, live()), { ok: false, error: "exists" });
  await store.addPairCode(late, live());
  const use = { codeHash: code.codeHash, atMs: 9_999 };
  assert.deepEqual(await store.usePairCode(use, live()), {
    ok: true,
    value: { ...code, usedAtMs: 9_999 },
  });
  assert.deepEqual(await store.usePairCode(use, live()), { ok: false, error: "used" });
  const expired = { codeHash: late.codeHash, atMs: 10_000 };
  assert.deepEqual(await store.usePairCode(expired, live()), { ok: false, error: "expired" });
  const unknown = { codeHash: fixtureHash("000000"), atMs: 1 };
  assert.deepEqual(await store.usePairCode(unknown, live()), { ok: false, error: "unknown" });
}

async function refusesAborted(store: AccessStore): Promise<void> {
  const stamp = { id: token(1).id, atMs: 1 };
  await assertRefusesAborted(async (options) => store.addToken(token(1), options));
  await assertRefusesAborted(async (options) => store.findToken(token(1).secretHash, options));
  await assertRefusesAborted(async (options) => store.listTokens(options));
  await assertRefusesAborted(async (options) => store.markTokenUsed(stamp, options));
  await assertRefusesAborted(async (options) => store.revokeToken(stamp, options));
  await assertRefusesAborted(async (options) => store.addDevice(device(1), options));
  await assertRefusesAborted(async (options) => store.listDevices(options));
  const code = { codeHash: fixtureHash("1"), expiresAtMs: 5 };
  await assertRefusesAborted(async (options) => store.addPairCode(code, options));
  const use = { codeHash: code.codeHash, atMs: 1 };
  await assertRefusesAborted(async (options) => store.usePairCode(use, options));
  assert.deepEqual(await store.listTokens(live()), []);
  assert.deepEqual(await store.listDevices(live()), []);
}

/** The contract every `AccessStore` adapter passes. */
export function accessStoreContract(harness: AccessStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<AccessStore> => harness.create();
  return [
    checkOn(
      "keeps tokens oldest first, and refuses an id or secret hash in use",
      create,
      keepsTokens,
    ),
    checkOn("moves a token's last use forward and keeps its first revoke", create, stampsTokens),
    checkOn("keeps devices with their last proof and first revoke", create, keepsDevices),
    checkOn("uses a pairing code once, before it expires", create, usesCodesOnce),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
