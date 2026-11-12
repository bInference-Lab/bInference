import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { type LaunchTicketRecord, maxLaunchTickets } from "../access/launch-ticket.js";
import type { TokenRecord } from "../access/token-record.js";
import {
  maxWebPushSubscriptionsPerDevice,
  type WebPushSubscriptionRecord,
} from "../access/web-push-subscription-record.js";
import type { AccessStore } from "../ports.js";
import { checkOn, fixtureHash, fixtureId, inOrder, live } from "./store-fixtures.js";

// The order of each ordered read the access store answers, pinned on rows of one millisecond
// written in an order their keys do not follow (database spec, section 6.7).

const instant = 7_000;

async function addDevice(store: AccessStore, n: number): Promise<void> {
  const device = {
    id: fixtureId("dev", n),
    label: `device ${String(n)}`,
    alg: "p256",
    publicKey: `BKey${String(n)}`,
    createdAtMs: instant,
  } as const;
  assert.ok((await store.addDevice(device, live())).ok);
}

/** Devices added in one millisecond list by id. */
async function listsDevicesById(store: AccessStore): Promise<void> {
  await inOrder([3, 1, 2], async (n) => addDevice(store, n));
  const listed = await store.listDevices(live());
  assert.deepEqual(
    listed.map(({ id }) => id),
    [1, 2, 3].map((n) => fixtureId("dev", n)),
  );
}

function runtimeToken(n: number): TokenRecord {
  return {
    id: fixtureId("tok", n),
    label: `runtime ${String(n)}`,
    kind: "runtime",
    scopes: ["read", "propose", "agent"],
    secretHash: fixtureHash(`bnt_runtime_${String(n)}`),
    createdAtMs: instant,
  };
}

/** A new runtime token revokes the runtime tokens of one millisecond before it in id order. */
async function revokesRuntimeTokensById(store: AccessStore): Promise<void> {
  await inOrder([3, 1, 2], async (n) => store.addToken(runtimeToken(n), live()));
  const replaced = await store.replaceRuntimeToken(runtimeToken(4), live());
  assert.deepEqual(replaced, { ok: true, value: [1, 2, 3].map((n) => fixtureId("tok", n)) });
}

function subscription(endpoint: string): WebPushSubscriptionRecord {
  return {
    endpoint: `https://push.example.invalid/${endpoint}`,
    deviceId: fixtureId("dev", 1),
    p256dh: `BKey${endpoint}`,
    auth: `secret${endpoint}`,
    serverKey: "BServerKey",
    createdAtMs: instant,
  };
}

/**
 * Subscriptions saved in one millisecond list by endpoint, and a device's cap keeps the greatest
 * endpoints of that millisecond.
 */
async function capsSubscriptionsByEndpoint(store: AccessStore): Promise<void> {
  await addDevice(store, 1);
  const endpoints = ["e", "a", "d", "b", "c"];
  assert.equal(endpoints.length, maxWebPushSubscriptionsPerDevice + 1);
  await inOrder(endpoints, async (endpoint) =>
    store.saveWebPushSubscription(subscription(endpoint), live()),
  );
  assert.deepEqual(
    await store.listWebPushSubscriptions(live()),
    ["b", "c", "d", "e"].map((endpoint) => subscription(endpoint)),
  );
}

/** Of launch tickets made in one millisecond, the one with the least hash goes first. */
async function dropsTheLeastTicketOfOneInstant(store: AccessStore): Promise<void> {
  const tickets = Array.from({ length: maxLaunchTickets + 1 }, (_, n): LaunchTicketRecord => ({
    ticketHash: fixtureHash(`ticket-${String(n)}`),
    userId: 279_058_397,
    issuedAtMs: instant,
    expiresAtMs: instant + 300_000,
  }));
  await inOrder(tickets, async (ticket) => store.addLaunchTicket(ticket, live()));
  const [least, next] = tickets.toSorted((a, b) => (a.ticketHash < b.ticketHash ? -1 : 1));
  assert.ok(least !== undefined && next !== undefined);
  // A hash the store still holds is refused; the dropped one is free again.
  assert.deepEqual(await store.addLaunchTicket(next, live()), { ok: false, error: "exists" });
  assert.deepEqual(await store.addLaunchTicket(least, live()), { ok: true, value: least });
}

/** The access store's checks of order among rows of one millisecond. */
export function accessOrderChecks(create: () => Promise<AccessStore>): readonly ContractCheck[] {
  return [
    checkOn("lists devices added in one millisecond by id", create, listsDevicesById),
    checkOn(
      "revokes the runtime tokens of one millisecond in id order",
      create,
      revokesRuntimeTokensById,
    ),
    checkOn(
      "keeps the greatest endpoints of one millisecond under a device's cap",
      create,
      capsSubscriptionsByEndpoint,
    ),
    checkOn(
      "drops the launch ticket with the least hash of one millisecond",
      create,
      dropsTheLeastTicketOfOneInstant,
    ),
  ];
}
