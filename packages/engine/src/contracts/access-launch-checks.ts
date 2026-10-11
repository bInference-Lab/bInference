import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type LaunchTicketRecord, maxLaunchTickets } from "../access/launch-ticket.js";
import type { AccessStore } from "../ports.js";
import type { Sha256Hex } from "../records/sha256-hex.js";
import { assertRefusesAborted, checkOn, fixtureHash, live } from "./store-fixtures.js";

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
}

/**
 * The access store contract's checks of the Mini App launches and their tickets (decisions 0160
 * and 0161), which `accessStoreContract` runs.
 */
export function launchChecks(create: () => Promise<AccessStore>): readonly ContractCheck[] {
  return [
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
    checkOn(
      "refuses a launch call on an aborted signal and stores nothing",
      create,
      refusesAborted,
    ),
  ];
}
