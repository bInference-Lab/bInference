import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { AlertRecord } from "../alerts/alert-record.js";
import { alertOf } from "./alert-fire-checks.js";
import type { AlertSubject } from "./alert-store-contract.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

// The order of each ordered read the alert store answers, pinned on rows of one millisecond
// written in an order their ids do not follow (database spec, section 6.7).

const instant = 5_000;
const hourMs = 3_600_000;

async function createAll(
  subject: AlertSubject,
  extra: Partial<AlertRecord>,
): Promise<readonly AlertRecord[]> {
  return inOrder([3, 1, 2], async (n) => {
    const alert = alertOf(subject, n, { createdAtMs: instant, changedAtMs: instant, ...extra });
    assert.ok((await subject.alerts.create(alert, live())).ok);
    return alert;
  });
}

const idsOf = (alerts: readonly { readonly id: string }[]): readonly string[] =>
  alerts.map(({ id }) => id);
const byNumber = (numbers: readonly number[]): readonly string[] =>
  numbers.map((n) => fixtureId("alr", n));

/** Alerts made in one millisecond page by id, the page after one going on from its id. */
async function pagesAlertsById(subject: AlertSubject): Promise<void> {
  await createAll(subject, {});
  const first = await subject.alerts.list({ states: ["active"], limit: 2 }, live());
  assert.deepEqual(idsOf(first), byNumber([1, 2]));
  const after = { createdAtMs: instant, id: fixtureId("alr", 2) };
  const next = await subject.alerts.list({ states: ["active"], limit: 2, after }, live());
  assert.deepEqual(idsOf(next), byNumber([3]));
}

/** Alerts that expire in one millisecond end by id, a page at a time. */
async function expiresAlertsById(subject: AlertSubject): Promise<void> {
  await createAll(subject, { expiresAtMs: instant + 1 });
  const first = await subject.alerts.expire({ atMs: instant + 1, limit: 2 }, live());
  assert.deepEqual(idsOf(first), byNumber([1, 2]));
  const next = await subject.alerts.expire({ atMs: instant + 1, limit: 2 }, live());
  assert.deepEqual(idsOf(next), byNumber([3]));
}

/** Alerts made in one millisecond with matches held tell them by id, a page at a time. */
async function tellsHeldNoticesById(subject: AlertSubject): Promise<void> {
  await createAll(subject, { noticeWindow: { startedAtMs: instant, sent: 5, held: 1 } });
  const due = { atMs: instant + hourMs, limit: 2 };
  const first = await subject.alerts.heldNotices(due, live());
  assert.deepEqual(idsOf(first.map(({ alert }) => alert)), byNumber([1, 2]));
  const next = await subject.alerts.heldNotices(due, live());
  assert.deepEqual(idsOf(next.map(({ alert }) => alert)), byNumber([3]));
}

/** The alert store's checks of order among rows of one millisecond. */
export function alertOrderChecks(create: () => Promise<AlertSubject>): readonly ContractCheck[] {
  return [
    checkOn("pages alerts made in one millisecond by id", create, pagesAlertsById),
    checkOn("ends alerts that expire in one millisecond by id", create, expiresAlertsById),
    checkOn(
      "tells the held matches of one millisecond's alerts by id",
      create,
      tellsHeldNoticesById,
    ),
  ];
}
