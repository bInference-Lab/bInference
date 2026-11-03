import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, live } from "./store-fixtures.js";
import {
  activatesOnTheConfirmedCard,
  createsRules,
  holdsTwentyRules,
  listsRules,
  neverMovesADeletedRule,
  refusesAFrozenAgentsRule,
  refusesStrangers,
  rotatesTheUrl,
} from "./webhook-rule-checks.js";
import {
  acceptedEvent,
  activeRule,
  ruleDraft,
  ruleId,
  ruleMove,
  takenAlert,
  type WebhookRuleStoreSubject,
} from "./webhook-rule-fixtures.js";

/** Makes a fresh, empty rule store for each check. */
export interface WebhookRuleStoreHarness {
  create(): Promise<WebhookRuleStoreSubject>;
}

const notice = { key: "notice.fill", values: {} };

// Ends an alert as a skip, with no move of its rule.
const skipOf = (event: number) => ({ event, outcome: "skipped" as const, reason: "late" as const });

async function endsASkippedAlert(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  assert.deepEqual(await store.alert(event, live()), {
    event,
    ruleId: ruleId(1),
    alertId: "alert at 5000",
    receivedAtMs: 5_000,
    wasEngineLocked: false,
  });
  const locked = await takenAlert(subject, { n: 1, atMs: 5_500, text: "a", isEngineLocked: true });
  assert.ok(locked.event !== undefined);
  assert.equal((await store.alert(locked.event, live()))?.wasEngineLocked, true);
  const ended = await store.endAlert({ ...skipOf(event), notices: [notice] }, live());
  assert.ok(ended.ok);
  assert.deepEqual([ended.value.outcome, ended.value.reason], ["skipped", "late"]);
  assert.deepEqual(await store.endAlert(skipOf(event), live()), { ok: false, error: "ended" });
  const repeat = await takenAlert(subject, { n: 1, atMs: 6_000, text: "alert at 5000" });
  assert.equal(repeat.kind, "repeat");
  assert.ok(repeat.event !== undefined);
  assert.equal(await store.alert(repeat.event, live()), undefined);
  assert.deepEqual(await store.endAlert(skipOf(repeat.event), live()), {
    ok: false,
    error: "not_found",
  });
}

async function keepsTheRuleWithAnEnd(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const hour = { startedAtMs: 5_000, sent: 1, held: 0 };
  const stale = { ...ruleMove(1, rule.version + 1, "active"), noticeHour: hour };
  assert.deepEqual(await store.endAlert({ ...skipOf(event), move: stale }, live()), {
    ok: false,
    error: "stale",
  });
  assert.equal((await store.alert(event, live()))?.outcome, undefined);
  const move = { ...ruleMove(1, rule.version, "active"), noticeHour: hour };
  assert.ok((await store.endAlert({ ...skipOf(event), move }, live())).ok);
  assert.deepEqual((await store.get(ruleId(1), live()))?.noticeHour, hour);
}

// A fill of alert `event` by intent 7, which counts one fill on rule 1 at `version`.
function fillOf(event: number, version: number) {
  const move = { ...ruleMove(1, version, "active"), fills: 1 };
  return { event, outcome: "filled" as const, intentId: fixtureId("int", 7), move };
}

async function fillsAnAlertOnce(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  assert.ok((await intents.create(intentDraft(subject, 7), live())).ok);
  const filled = { ...intentMove(7, 0, "checked"), alert: fillOf(event, rule.version) };
  assert.ok((await intents.transition(filled, live())).ok);
  const alert = await store.alert(event, live());
  assert.deepEqual([alert?.outcome, alert?.intentId], ["filled", fixtureId("int", 7)]);
  assert.equal((await store.get(ruleId(1), live()))?.fills, 1);
  const again = { ...intentMove(7, 1, "quoted"), alert: fillOf(event, rule.version + 1) };
  assert.deepEqual(await intents.transition(again, live()), { ok: false, error: "stale" });
  assert.equal((await intents.get(fixtureId("int", 7), live()))?.state, "checked");
  assert.equal((await store.get(ruleId(1), live()))?.fills, 1);
}

async function listsAlertsAndAnnounces(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  const first = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const second = await acceptedEvent(subject, { n: 1, atMs: 5_001 });
  const alerts = await store.alerts({ ruleId: ruleId(1), limit: 10 }, live());
  assert.deepEqual(
    alerts.map(({ event }) => event),
    [second, first],
  );
  assert.ok((await store.endAlert({ ...skipOf(first), notices: [notice] }, live())).ok);
  assert.ok((await store.endAlert(skipOf(second), live())).ok);
  const due = await store.unannounced(10, live());
  assert.deepEqual(
    due.map(({ event, notices }) => [event, notices]),
    [[first, [notice]]],
  );
  await store.markAnnounced({ events: [first], atMs: 9_000 }, live());
  await store.markAnnounced({ events: [first], atMs: 9_500 }, live());
  assert.deepEqual(await store.unannounced(10, live()), []);
  assert.equal((await store.alert(first, live()))?.announcedAtMs, 9_000);
}

// Rule 1 takes 5 alerts a minute: the sixth new one in a minute is over its rate.
async function pagesEveryAlert(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  await activeRule(subject, 2);
  const first = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const repeat = await takenAlert(subject, { n: 1, atMs: 5_100, text: "alert at 5000" });
  await acceptedEvent(subject, { n: 2, atMs: 5_200 });
  const accepted = [first];
  for (const atMs of [5_300, 5_400, 5_500, 5_600]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the rows take their numbers in order
    accepted.push(await acceptedEvent(subject, { n: 1, atMs }));
  }
  const rate = await takenAlert(subject, { n: 1, atMs: 5_700, text: "one more" });
  assert.deepEqual([repeat.kind, rate.kind], ["repeat", "rate"]);
  assert.ok((await store.endAlert(skipOf(first), live())).ok);
  const page = await store.events({ ruleId: ruleId(1), limit: 2 }, live());
  assert.deepEqual(
    page.map(({ event, taken }) => [event, taken]),
    [
      [rate.event, "rate"],
      [accepted.at(-1), "accepted"],
    ],
  );
  const rest = await store.events(
    { ruleId: ruleId(1), before: repeat.event ?? 0, limit: 10 },
    live(),
  );
  assert.deepEqual(rest, [
    {
      event: first,
      ruleId: ruleId(1),
      alertId: "alert at 5000",
      receivedAtMs: 5_000,
      taken: "accepted",
      outcome: "skipped",
      reason: "late",
    },
  ]);
  const all = await store.events({ ruleId: ruleId(1), limit: 100 }, live());
  assert.equal(all.length, 7);
  assert.deepEqual(await store.events({ ruleId: ruleId(3), limit: 10 }, live()), []);
}

async function refusesAborted(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  const draft = ruleDraft(subject, 1);
  await assertRefusesAborted(async (call) => store.create(draft, call));
  await assertRefusesAborted(async (call) => store.get(draft.id, call));
  await assertRefusesAborted(async (call) => store.byIntent(draft.intentId, call));
  await assertRefusesAborted(async (call) => store.list({ states: ["active"], limit: 1 }, call));
  await assertRefusesAborted(async (call) => store.move(ruleMove(1, 0, "deleted"), call));
  await assertRefusesAborted(async (call) => store.alert(1, call));
  await assertRefusesAborted(async (call) => store.alerts({ ruleId: draft.id, limit: 1 }, call));
  await assertRefusesAborted(async (call) => store.events({ ruleId: draft.id, limit: 1 }, call));
  await assertRefusesAborted(async (call) => store.endAlert(skipOf(1), call));
  await assertRefusesAborted(async (call) => store.unannounced(1, call));
  await assertRefusesAborted(async (call) => store.markAnnounced({ events: [1], atMs: 1 }, call));
  assert.equal(await store.get(draft.id, live()), undefined);
}

/**
 * The checks every {@link WebhookRuleStore} adapter must pass, each on a fresh subject: rules stored
 * awaiting their card, 20 at most per agent, active only on their confirmed card and never for a
 * frozen agent, rotated, listed and deleted for good; each accepted alert ended once, as a skip
 * alone or as a fill with its intent's move, which counts it on its rule; notices announced once.
 */
export function webhookRuleStoreContract(
  harness: WebhookRuleStoreHarness,
): readonly ContractCheck[] {
  const fresh = async (): Promise<WebhookRuleStoreSubject> => harness.create();
  return [
    checkOn("stores a rule awaiting its card and reads it back", fresh, createsRules),
    checkOn("refuses a rule of another agent's wallet", fresh, refusesStrangers),
    checkOn("holds 20 rules per agent until one is deleted", fresh, holdsTwentyRules),
    checkOn("makes a rule active only on its confirmed card", fresh, activatesOnTheConfirmedCard),
    checkOn("never activates or takes a rule of a frozen agent", fresh, refusesAFrozenAgentsRule),
    checkOn("rotates a rule's URL and counts its fills", fresh, rotatesTheUrl),
    checkOn("lists rules by state and agent, a page at a time", fresh, listsRules),
    checkOn("never moves a deleted rule again", fresh, neverMovesADeletedRule),
    checkOn("ends an accepted alert once as a skip", fresh, endsASkippedAlert),
    checkOn("ends an alert with its rule's move, or not at all", fresh, keepsTheRuleWithAnEnd),
    checkOn("fills an alert once, with its intent's move", fresh, fillsAnAlertOnce),
    checkOn(
      "lists a rule's alerts and announces their notices once",
      fresh,
      listsAlertsAndAnnounces,
    ),
    checkOn("pages a rule's alerts in every outcome, the newest first", fresh, pagesEveryAlert),
    checkOn("refuses every call on an aborted signal and stores nothing", fresh, refusesAborted),
  ];
}
