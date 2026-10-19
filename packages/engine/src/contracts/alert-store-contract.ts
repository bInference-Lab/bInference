import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { maxActiveAlerts, maxTrackedWallets } from "../alerts/alert-record.js";
import type { AlertStore } from "../alerts/ports.js";
import type { AgentInboxStore } from "../chat/ports.js";
import { alertFireChecks, alertOf, priceCondition, walletCondition } from "./alert-fire-checks.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** An alert store under test, the agent inbox of the same database, and two agents there. */
export interface AlertSubject {
  readonly alerts: AlertStore;
  readonly agentInbox: AgentInboxStore;
  readonly agentIds: readonly [Id<"agt">, Id<"agt">];
}

/** Makes a fresh subject for each check. */
export interface AlertStoreHarness {
  create(): Promise<AlertSubject>;
}

async function storesAndLists(subject: AlertSubject): Promise<void> {
  const { alerts, agentIds } = subject;
  const price = alertOf(subject, 2, { condition: priceCondition });
  const wallet = alertOf(subject, 1);
  const other = alertOf(subject, 3, { agentId: agentIds[1] });
  assert.deepEqual(await alerts.create(price, live()), { ok: true, value: price });
  await inOrder([wallet, other], async (alert) => alerts.create(alert, live()));
  assert.deepEqual(await alerts.get(price.id, live()), price);
  assert.equal(await alerts.get(fixtureId("alr", 9), live()), undefined);
  const active = { states: ["active"], limit: 10 } as const;
  assert.deepEqual(await alerts.list(active, live()), [wallet, price, other]);
  assert.deepEqual(await alerts.list({ ...active, agentId: agentIds[0] }, live()), [wallet, price]);
  assert.deepEqual(await alerts.list({ ...active, kind: "price" }, live()), [price]);
  const after = { createdAtMs: wallet.createdAtMs, id: wallet.id };
  assert.deepEqual(await alerts.list({ ...active, after, limit: 1 }, live()), [price]);
  assert.deepEqual(await alerts.list({ states: ["fired"], limit: 10 }, live()), []);
  const stranger = alertOf(subject, 4, { agentId: fixtureId("agt", 99) });
  assert.deepEqual(await alerts.create(stranger, live()), { ok: false, error: "not_found" });
}

async function holdsFiftyActive(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  const numbers = Array.from({ length: maxActiveAlerts }, (_, index) => index + 1);
  await inOrder(numbers, async (n) =>
    alerts.create(alertOf(subject, n, { condition: priceCondition }), live()),
  );
  const more = alertOf(subject, maxActiveAlerts + 1, { condition: priceCondition });
  assert.deepEqual(await alerts.create(more, live()), { ok: false, error: "too_many" });
  await alerts.delete({ id: fixtureId("alr", 1), atMs: 9 }, live());
  assert.equal((await alerts.create(more, live())).ok, true);
}

// The first agent tracks 30 wallets and the second 20; a 51st wallet is refused, one already
// tracked passes, and a deleted alert frees its wallet.
async function tracksFiftyWallets(subject: AlertSubject): Promise<void> {
  const { alerts, agentIds } = subject;
  const numbers = Array.from({ length: maxTrackedWallets }, (_, index) => index + 1);
  await inOrder(numbers, async (n) =>
    alerts.create(alertOf(subject, n, n > 30 ? { agentId: agentIds[1] } : {}), live()),
  );
  const more = alertOf(subject, 60, { condition: walletCondition(60) });
  assert.deepEqual(await alerts.create(more, live()), { ok: false, error: "track_limit" });
  const again = alertOf(subject, 61, { condition: walletCondition(5), agentId: agentIds[1] });
  assert.equal((await alerts.create(again, live())).ok, true);
  await alerts.delete({ id: fixtureId("alr", 7), atMs: 9 }, live());
  assert.equal((await alerts.create(more, live())).ok, true);
}

async function deletesOnce(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  const alert = alertOf(subject, 1);
  await alerts.create(alert, live());
  const deleted = { ...alert, state: "deleted", changedAtMs: 50 };
  assert.deepEqual(await alerts.delete({ id: alert.id, atMs: 50 }, live()), deleted);
  assert.equal(await alerts.delete({ id: alert.id, atMs: 60 }, live()), undefined);
  assert.equal(await alerts.delete({ id: fixtureId("alr", 9), atMs: 60 }, live()), undefined);
}

async function endsAtExpiry(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  const late = alertOf(subject, 1, { expiresAtMs: 300 });
  const early = alertOf(subject, 2, { expiresAtMs: 200 });
  await inOrder([late, early, alertOf(subject, 3)], async (alert) => alerts.create(alert, live()));
  assert.deepEqual(await alerts.expire({ atMs: 199, limit: 10 }, live()), []);
  const ended = await alerts.expire({ atMs: 300, limit: 10 }, live());
  assert.deepEqual(
    ended.map(({ id, state, changedAtMs }) => [id, state, changedAtMs]),
    [
      [early.id, "ended", 300],
      [late.id, "ended", 300],
    ],
  );
  const active = await alerts.list({ states: ["active"], limit: 10 }, live());
  assert.deepEqual(
    active.map(({ id }) => id),
    [fixtureId("alr", 3)],
  );
}

async function refusesAborted(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  await assertRefusesAborted(async (options) => alerts.create(alertOf(subject, 1), options));
  await assertRefusesAborted(async (options) => alerts.expire({ atMs: 1, limit: 1 }, options));
  assert.deepEqual(await alerts.list({ states: ["active"], limit: 10 }, live()), []);
}

/** The checks every {@link AlertStore} passes. */
export function alertStoreContract(harness: AlertStoreHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("stores alerts and lists them by state, agent and kind", create, storesAndLists),
    checkOn("holds at most 50 active alerts per agent", create, holdsFiftyActive),
    checkOn("tracks at most 50 wallets across the install", create, tracksFiftyWallets),
    checkOn("deletes an active alert once", create, deletesOnce),
    checkOn("ends the alerts whose expiry came", create, endsAtExpiry),
    ...alertFireChecks.map(([name, check]) => checkOn(name, create, check)),
    checkOn("refuses a call on an aborted signal and stores nothing", create, refusesAborted),
  ];
}
