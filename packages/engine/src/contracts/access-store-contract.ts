import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { DeviceRecord } from "../access/device-record.js";
import { type LaunchTicketRecord, maxLaunchTickets } from "../access/launch-ticket.js";
import type { TokenRecord } from "../access/token-record.js";
import type { WebPushSubscriptionRecord } from "../access/web-push-subscription-record.js";
import type { AccessStore } from "../ports.js";
import type { Sha256Hex } from "../records/sha256-hex.js";
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
  const expiring = { ...token(5), expiresAtMs: 9_000 };
  await store.addToken(expiring, live());
  assert.deepEqual(await store.findToken(expiring.secretHash, live()), expiring);
  const sameId = { ...token(1), secretHash: fixtureHash("other") };
  const sameSecret = { ...token(4), secretHash: token(1).secretHash };
  assert.deepEqual(await store.addToken(sameId, live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.addToken(sameSecret, live()), { ok: false, error: "exists" });
  assert.equal((await store.listTokens(live())).length, 4);
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
  // A sign-in reads the revoke from the record its use answers.
  const late = await store.markTokenUsed({ id, atMs: 8_000 }, live());
  assert.deepEqual(late, { ok: true, value: { ...revoked, lastUsedAtMs: 8_000 } });
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
  // A sign-in reads the revoke from the record its proof answers.
  const late = await store.markDeviceSeen({ id, atMs: 8_000 }, live());
  assert.deepEqual(late, { ok: true, value: { ...revoked, lastSeenAtMs: 8_000 } });
  assert.equal(await store.findDevice(device(9).id, live()), undefined);
  const unknown = { id: device(9).id, atMs: 1 };
  assert.deepEqual(await store.markDeviceSeen(unknown, live()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.revokeDevice(unknown, live()), { ok: false, error: "not_found" });
}

function subscription(endpoint: string, n: number, atMs: number): WebPushSubscriptionRecord {
  return {
    endpoint: `https://push.example.invalid/${endpoint}`,
    deviceId: device(n).id,
    p256dh: `BKey${endpoint}${String(atMs)}`,
    auth: `secret${endpoint}`,
    serverKey: "BServerKey",
    createdAtMs: atMs,
  };
}

async function keepsSubscriptions(store: AccessStore): Promise<void> {
  await store.addDevice(device(1), live());
  await store.addDevice(device(2), live());
  const first = subscription("a", 1, 10);
  assert.deepEqual(await store.saveWebPushSubscription(first, live()), { ok: true, value: first });
  await store.saveWebPushSubscription(subscription("b", 2, 5), live());
  const moved = subscription("a", 2, 20);
  await store.saveWebPushSubscription(moved, live());
  assert.deepEqual(await store.listWebPushSubscriptions(live()), [subscription("b", 2, 5), moved]);
  const unknown = subscription("c", 9, 30);
  assert.deepEqual(await store.saveWebPushSubscription(unknown, live()), {
    ok: false,
    error: "no_device",
  });
  await store.revokeDevice({ id: device(1).id, atMs: 40 }, live());
  const revoked = subscription("d", 1, 50);
  assert.deepEqual(await store.saveWebPushSubscription(revoked, live()), {
    ok: false,
    error: "no_device",
  });
}

async function dropsSubscriptions(store: AccessStore): Promise<void> {
  await store.addDevice(device(1), live());
  await store.addDevice(device(2), live());
  const own = subscription("a", 1, 10);
  await store.saveWebPushSubscription(own, live());
  await store.saveWebPushSubscription(subscription("b", 2, 20), live());
  const other = { endpoint: own.endpoint, deviceId: device(2).id };
  assert.deepEqual(await store.dropWebPushSubscription(other, live()), {
    ok: false,
    error: "not_found",
  });
  const mine = { endpoint: own.endpoint, deviceId: device(1).id };
  assert.deepEqual(await store.dropWebPushSubscription(mine, live()), { ok: true, value: own });
  assert.deepEqual(await store.dropWebPushSubscription(mine, live()), {
    ok: false,
    error: "not_found",
  });
  await store.revokeDevice({ id: device(2).id, atMs: 30 }, live());
  assert.deepEqual(await store.listWebPushSubscriptions(live()), []);
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

const launchUser = 279_058_397;

// Claims a launch with a fresh ticket `n`, made for the launch's user a moment before it.
async function claimWithTicket(
  store: AccessStore,
  launch: { readonly launchHash: Sha256Hex; readonly atMs: number; readonly sinceMs: number },
  n: number,
): Promise<string> {
  const made = ticket(n, launch.atMs - 1);
  await store.addLaunchTicket(made, live());
  const claim = { ...launch, ticketHash: made.ticketHash, userId: launchUser };
  return store.claimLaunch(claim, live());
}

async function claimsLaunchesOnce(store: AccessStore): Promise<void> {
  const first = { launchHash: fixtureHash("launch-a"), atMs: 1_000, sinceMs: 0 };
  const other = { launchHash: fixtureHash("launch-b"), atMs: 2_000, sinceMs: 0 };
  assert.equal(await claimWithTicket(store, first, 1), "claimed");
  assert.equal(await claimWithTicket(store, other, 2), "claimed");
  const again = { ...first, atMs: 3_000, sinceMs: 1_000 };
  assert.equal(await claimWithTicket(store, again, 3), "seen");
  assert.equal(await claimWithTicket(store, again, 4), "seen");
  const later = { ...first, atMs: 5_000, sinceMs: 1_001 };
  assert.equal(await claimWithTicket(store, later, 5), "claimed");
  const otherAgain = { ...other, atMs: 5_000, sinceMs: 1_001 };
  assert.equal(await claimWithTicket(store, otherAgain, 6), "seen");
  const past = { ...other, atMs: 9_000, sinceMs: 5_001 };
  assert.equal(await claimWithTicket(store, past, 7), "claimed");
  const firstPast = { ...past, launchHash: first.launchHash };
  assert.equal(await claimWithTicket(store, firstPast, 8), "claimed");
}

async function spendsTickets(store: AccessStore): Promise<void> {
  const launch = (name: string, atMs: number) => ({
    launchHash: fixtureHash(name),
    ticketHash: ticket(1, 1_000).ticketHash,
    userId: launchUser,
    atMs,
    sinceMs: 0,
  });
  assert.equal(await store.claimLaunch(launch("a", 1_500), live()), "no_ticket");
  await store.addLaunchTicket(ticket(1, 1_000), live());
  const stranger = { ...launch("a", 1_500), userId: launchUser + 1 };
  assert.equal(await store.claimLaunch(stranger, live()), "no_ticket");
  assert.equal(await store.claimLaunch(launch("a", 1_500), live()), "claimed");
  assert.equal(await store.claimLaunch(launch("b", 1_600), live()), "no_ticket");
  // A seen launch leaves the ticket it came with.
  await store.addLaunchTicket(ticket(1, 2_000), live());
  assert.equal(await store.claimLaunch(launch("a", 2_100), live()), "seen");
  assert.equal(await store.claimLaunch(launch("c", 2_200), live()), "claimed");
  // An expired ticket is deleted and refused.
  await store.addLaunchTicket(ticket(1, 3_000), live());
  assert.equal(await store.claimLaunch(launch("d", 303_000), live()), "ticket_expired");
  assert.equal(await store.claimLaunch(launch("d", 303_001), live()), "no_ticket");
}

function ticket(n: number, issuedAtMs: number): LaunchTicketRecord {
  const ticketHash = fixtureHash(`ticket-${String(n)}`);
  return { ticketHash, userId: launchUser, issuedAtMs, expiresAtMs: issuedAtMs + 300_000 };
}

async function keepsLaunchTickets(store: AccessStore): Promise<void> {
  assert.deepEqual(await store.addLaunchTicket(ticket(1, 1_000), live()), {
    ok: true,
    value: ticket(1, 1_000),
  });
  const again = { ...ticket(1, 1_000), issuedAtMs: 2_000 };
  assert.deepEqual(await store.addLaunchTicket(again, live()), { ok: false, error: "exists" });
  // Once ticket 1 expired, its hash is free again.
  assert.deepEqual(await store.addLaunchTicket(ticket(1, 301_000), live()), {
    ok: true,
    value: ticket(1, 301_000),
  });
  const fill = Array.from({ length: maxLaunchTickets }, (_, i) => ticket(i + 2, 301_002 + i));
  await fill.reduce(async (previous, next) => {
    await previous;
    await store.addLaunchTicket(next, live());
  }, Promise.resolve());
  // The oldest, ticket 1, made room for the newest: its hash is free, the others' are kept.
  const oldest = { ...ticket(1, 302_000), expiresAtMs: 602_000 };
  assert.deepEqual(await store.addLaunchTicket(oldest, live()), { ok: true, value: oldest });
  const kept = ticket(maxLaunchTickets + 1, 302_001);
  assert.deepEqual(await store.addLaunchTicket(kept, live()), { ok: false, error: "exists" });
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
  const saved = subscription("a", 1, 1);
  await assertRefusesAborted(async (options) => store.saveWebPushSubscription(saved, options));
  await assertRefusesAborted(async (options) => store.listWebPushSubscriptions(options));
  const drop = { endpoint: saved.endpoint };
  await assertRefusesAborted(async (options) => store.dropWebPushSubscription(drop, options));
  const code = { codeHash: fixtureHash("1"), expiresAtMs: 5 };
  await assertRefusesAborted(async (options) => store.addPairCode(code, options));
  const use = { codeHash: code.codeHash, atMs: 1 };
  await assertRefusesAborted(async (options) => store.usePairCode(use, options));
  const launch = {
    launchHash: fixtureHash("launch"),
    ticketHash: ticket(1, 1).ticketHash,
    userId: launchUser,
    atMs: 2,
    sinceMs: 0,
  };
  await assertRefusesAborted(async (options) => store.addLaunchTicket(ticket(1, 1), options));
  assert.deepEqual(await store.addLaunchTicket(ticket(1, 1), live()), {
    ok: true,
    value: ticket(1, 1),
  });
  await assertRefusesAborted(async (options) => store.claimLaunch(launch, options));
  assert.equal(await store.claimLaunch(launch, live()), "claimed");
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
    checkOn(
      "keeps one browser push subscription per endpoint, only for a device that is not revoked",
      create,
      keepsSubscriptions,
    ),
    checkOn(
      "drops a subscription at its endpoint, for its own device only, and those of a revoked device",
      create,
      dropsSubscriptions,
    ),
    checkOn("uses a pairing code once, before it expires", create, usesCodesOnce),
    checkOn(
      "claims a Mini App launch once, and forgets the claims from before the given time",
      create,
      claimsLaunchesOnce,
    ),
    checkOn(
      "spends a launch's ticket only when it claims the launch, and refuses an expired one",
      create,
      spendsTickets,
    ),
    checkOn(
      "keeps launch tickets until they expire, at most the newest 16, each hash once",
      create,
      keepsLaunchTickets,
    ),
    checkOn("refuses every call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
