import assert from "node:assert/strict";
import { accountRefSchema, assetRefSchema } from "@binference/chain";
import type { AlertCondition } from "@binference/protocol";
import type { AlertFireDraft } from "../alerts/alert-fire.js";
import type { AlertRecord } from "../alerts/alert-record.js";
import type { AlertSubject } from "./alert-store-contract.js";
import { fillAgentInbox } from "./inbox-fixtures.js";
import { assertRefusesAborted, fixtureId, inOrder, live } from "./store-fixtures.js";

const session = fixtureId("ses", 1);
const hourMs = 3_600_000;

/** A price condition on a fixture token. */
export const priceCondition: AlertCondition = {
  kind: "price",
  asset: assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059ff775485246999027b3197955"),
  direction: "above",
  price: 2n ** 64n + 1n,
};

/** A wallet condition on the fixture account `n`. */
export function walletCondition(n: number): AlertCondition {
  const address = `0x${n.toString(16).padStart(40, "0")}`;
  return { kind: "wallet", account: accountRefSchema.parse(`eip155:56:${address}`) };
}

/** Alert `n` of the subject's first agent, active and woken on each fire, made at `n`. */
export function alertOf(
  subject: AlertSubject,
  n: number,
  extra: Partial<AlertRecord> = {},
): AlertRecord {
  return {
    id: fixtureId("alr", n),
    agentId: subject.agentIds[0],
    condition: walletCondition(n),
    state: "active",
    wake: true,
    fires: 0,
    outsideContent: true,
    createdBy: "telegram",
    createdAtMs: n,
    changedAtMs: n,
    ...extra,
  };
}

/** The fire of alert `n` at `atMs`, after `expectedFires`, with its wake-up. */
function fireOf(n: number, atMs: number, expectedFires = 0): AlertFireDraft {
  return {
    id: fixtureId("alr", n),
    expectedFires,
    atMs,
    wake: {
      id: fixtureId("msg", atMs),
      turnId: fixtureId("trn", atMs),
      opens: session,
      payload: { fired: atMs },
    },
  };
}

async function created(subject: AlertSubject, alert: AlertRecord): Promise<void> {
  assert.equal((await subject.alerts.create(alert, live())).ok, true);
}

async function firesAPriceAlertOnce(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  await created(subject, alertOf(subject, 1, { condition: priceCondition, wake: false }));
  const { wake: _wake, ...quiet } = fireOf(1, 50);
  const fired = await alerts.fire(quiet, live());
  assert.deepEqual(fired.ok && [fired.value.alert.state, fired.value.alert.fires], ["fired", 1]);
  assert.deepEqual(fired.ok && [fired.value.woke, fired.value.message], [false, undefined]);
  assert.equal(fired.ok && fired.value.alert.firedAtMs, 50);
  assert.deepEqual(await alerts.fire({ ...quiet, expectedFires: 1 }, live()), {
    ok: false,
    error: "stale",
  });
}

async function wakesAndReplacesWhileWaiting(subject: AlertSubject): Promise<void> {
  const { alerts, agentInbox, agentIds } = subject;
  await created(subject, alertOf(subject, 1));
  const first = await alerts.fire(fireOf(1, 100), live());
  assert.ok(first.ok);
  assert.equal(first.value.message?.kind, "inbox/alertFired");
  assert.equal(first.value.alert.lastMessageId, first.value.message?.id);
  const second = await alerts.fire(fireOf(1, 200, 1), live());
  assert.ok(second.ok);
  assert.deepEqual([second.value.woke, second.value.message?.id], [true, first.value.message?.id]);
  const untaken = await agentInbox.untaken({ agentId: agentIds[0], limit: 10 }, live());
  assert.deepEqual(
    untaken.map(({ payload }) => payload),
    [{ fired: 200 }],
  );
  await agentInbox.take({ ids: untaken.map(({ id }) => id), atMs: 250 }, live());
  const third = await alerts.fire(fireOf(1, 300, 2), live());
  assert.ok(third.ok);
  assert.notEqual(third.value.message?.id, first.value.message?.id);
  assert.equal(third.value.alert.fires, 3);
}

// Ten alerts each wake the agent once; an eleventh fire in the hour is held back, and the next
// wake-up after the hour counts it.
async function holdsWakesToTenAnHour(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  const numbers = Array.from({ length: 12 }, (_, index) => index + 1);
  await inOrder(numbers, async (n) => created(subject, alertOf(subject, n)));
  await inOrder(numbers.slice(0, 10), async (n) => alerts.fire(fireOf(n, n * 1_000), live()));
  const eleventh = await alerts.fire(fireOf(11, 20_000), live());
  assert.deepEqual(eleventh.ok && [eleventh.value.woke, eleventh.value.skip], [false, "hourly"]);
  const later = await alerts.fire(fireOf(12, 1_000 + hourMs), live());
  assert.deepEqual(later.ok && [later.value.woke, later.value.wakeSkipped], [true, 1]);
}

async function recordsSkips(subject: AlertSubject): Promise<void> {
  const { alerts, agentInbox, agentIds } = subject;
  await created(subject, alertOf(subject, 1));
  await created(subject, alertOf(subject, 2));
  const frozen = await alerts.fire({ ...fireOf(1, 100), skip: "frozen" }, live());
  assert.deepEqual(frozen.ok && [frozen.value.woke, frozen.value.skip], [false, "frozen"]);
  assert.equal(frozen.ok && frozen.value.alert.fires, 1);
  await fillAgentInbox(agentInbox, { agentId: agentIds[0], session });
  const busy = await alerts.fire(fireOf(2, 200), live());
  assert.deepEqual(busy.ok && [busy.value.woke, busy.value.skip], [false, "busy"]);
}

async function refusesStaleFires(subject: AlertSubject): Promise<void> {
  const { alerts } = subject;
  const stale = { ok: false, error: "stale" };
  await created(subject, alertOf(subject, 1, { expiresAtMs: 500 }));
  assert.deepEqual(await alerts.fire(fireOf(1, 500), live()), stale);
  assert.deepEqual(await alerts.fire(fireOf(1, 100, 3), live()), stale);
  assert.deepEqual(await alerts.fire(fireOf(2, 100), live()), stale);
  await alerts.delete({ id: fixtureId("alr", 1), atMs: 50 }, live());
  assert.deepEqual(await alerts.fire(fireOf(1, 100), live()), stale);
  await assertRefusesAborted(async (options) => alerts.fire(fireOf(1, 100), options));
}

/** The checks of {@link AlertStore.fire}, which the alert store contract runs. */
export const alertFireChecks: readonly (readonly [
  string,
  (subject: AlertSubject) => Promise<void>,
])[] = [
  ["fires a price alert once and stores no wake-up without wake", firesAPriceAlertOnce],
  ["wakes the agent once and replaces the wake-up while it waits", wakesAndReplacesWhileWaiting],
  ["holds the agent's wake-ups to 10 an hour and counts those held back", holdsWakesToTenAnHour],
  ["records a skipped wake-up and skips while the inbox is full", recordsSkips],
  ["refuses a fire the alert cannot take", refusesStaleFires],
];
