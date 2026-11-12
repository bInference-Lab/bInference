import assert from "node:assert/strict";
import { assertRefusesNulText, type ContractCheck, withNul } from "@binference/core/testing";
import type { InboxStore } from "../ingress/ports.js";
import type { WebhookAlertStore } from "../webhooks/ports.js";
import {
  type WebhookAlertDraft,
  webhookInboxPrefix,
  webhookRateWindowMs,
  webhookRepeatWindowMs,
  type WebhookRuleKey,
  type WebhookTake,
} from "../webhooks/webhook-alert.js";
import {
  assertRefusesAborted,
  checkOn,
  fixtureHash,
  fixtureId,
  inOrder,
  live,
} from "./store-fixtures.js";

/** A webhook alert store under test, the inbox of the same database, and a way to plant rules. */
export interface WebhookAlertSubject {
  readonly alerts: WebhookAlertStore;
  readonly inbox: InboxStore;
  /** Stores a rule as its operations would, in place of one with the same id. */
  plant(rule: WebhookRuleKey): Promise<void>;
}

/** Makes a fresh, empty store with no rule for each check. */
export interface WebhookAlertStoreHarness {
  create(): Promise<WebhookAlertSubject>;
}

const t0 = 1_760_000_000_000;

function ruleOf(n: number, changes: Partial<WebhookRuleKey> = {}): WebhookRuleKey {
  return {
    id: fixtureId("whr", n),
    secretHash: fixtureHash(`secret ${String(n)}`),
    state: "active",
    ratePerMinute: 60,
    ...changes,
  };
}

function alertOf(
  rule: WebhookRuleKey,
  changes: Partial<WebhookAlertDraft> = {},
): WebhookAlertDraft {
  return {
    rule: rule.id,
    secretHash: rule.secretHash,
    body: { text: "BNBUSDT crossed 600" },
    bodyHash: fixtureHash(`body ${String(changes.receivedAtMs ?? t0)}`),
    receivedAtMs: t0,
    ...changes,
  };
}

async function planted(harness: WebhookAlertStoreHarness, rules: readonly WebhookRuleKey[]) {
  const subject = await harness.create();
  await inOrder(rules, async (rule) => subject.plant(rule));
  return subject;
}

async function takeAll(
  subject: WebhookAlertSubject,
  drafts: readonly WebhookAlertDraft[],
): Promise<readonly WebhookTake["kind"][]> {
  return inOrder(drafts, async (draft) => (await subject.alerts.take(draft, live())).kind);
}

async function alertsInInbox(subject: WebhookAlertSubject): Promise<number> {
  const page = { keyPrefix: webhookInboxPrefix, limit: 1_000 };
  return (await subject.inbox.unhandled(page, live())).length;
}

async function findsRules(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1, { state: "deleted", ratePerMinute: 5, expiresAtMs: t0 + 1 });
  const subject = await planted(harness, [rule, ruleOf(2)]);
  assert.deepEqual(await subject.alerts.findRule(rule.id, live()), rule);
  assert.deepEqual(await subject.alerts.findRule(fixtureId("whr", 3), live()), undefined);
}

async function acceptsIntoInbox(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1);
  const subject = await planted(harness, [rule]);
  const json = { text: '{"id":"tv-1","note":"buy"}' };
  const taken = await subject.alerts.take(alertOf(rule, { alertId: "tv-1", body: json }), live());
  assert.equal(taken.kind, "accepted");
  const bytes = { base64: "//79" };
  const bare = await subject.alerts.take(
    alertOf(rule, { body: bytes, receivedAtMs: t0 + 1 }),
    live(),
  );
  assert.ok(taken.kind === "accepted" && bare.kind === "accepted");
  assert.notEqual(taken.event, bare.event);
  const entries = await subject.inbox.unhandled(
    { keyPrefix: webhookInboxPrefix, limit: 10 },
    live(),
  );
  assert.deepEqual(entries, [
    {
      id: taken.entry,
      source: "webhook",
      sourceKey: `wh:${String(taken.event)}`,
      payload: { rule: rule.id, event: taken.event, alertId: "tv-1", body: json },
      receivedAtMs: t0,
    },
    {
      id: bare.entry,
      source: "webhook",
      sourceKey: `wh:${String(bare.event)}`,
      payload: { rule: rule.id, event: bare.event, body: bytes },
      receivedAtMs: t0 + 1,
    },
  ]);
}

async function refusesRepeats(harness: WebhookAlertStoreHarness): Promise<void> {
  const [rule, other] = [ruleOf(1), ruleOf(2)];
  const subject = await planted(harness, [rule, other]);
  const body = fixtureHash("the same body");
  const late = t0 + webhookRepeatWindowMs;
  const kinds = await takeAll(subject, [
    alertOf(rule, { alertId: "a" }),
    alertOf(rule, { alertId: "a", receivedAtMs: t0 + 1 }),
    alertOf(rule, { bodyHash: body, receivedAtMs: t0 + 2 }),
    alertOf(rule, { bodyHash: body, alertId: "b", receivedAtMs: t0 + 3 }),
    alertOf(other, { alertId: "a", bodyHash: body, receivedAtMs: t0 + 4 }),
    alertOf(rule, { alertId: "a", receivedAtMs: late - 1 }),
    alertOf(rule, { alertId: "a", receivedAtMs: late }),
  ]);
  assert.deepEqual(kinds, [
    "accepted",
    "repeat",
    "accepted",
    "repeat",
    "accepted",
    "repeat",
    "accepted",
  ]);
  assert.equal(await alertsInInbox(subject), 4);
}

async function holdsTheRate(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1, { ratePerMinute: 2 });
  const subject = await planted(harness, [rule]);
  const at = (offsetMs: number) => alertOf(rule, { receivedAtMs: t0 + offsetMs });
  const kinds = await takeAll(subject, [
    at(0),
    at(10),
    at(20),
    at(webhookRateWindowMs - 1),
    at(webhookRateWindowMs),
    at(webhookRateWindowMs + 1),
    at(webhookRateWindowMs + 10),
  ]);
  assert.deepEqual(kinds, ["accepted", "accepted", "rate", "rate", "accepted", "rate", "accepted"]);
  assert.equal(await alertsInInbox(subject), 4);
}

async function goneWhenNotAnswering(harness: WebhookAlertStoreHarness): Promise<void> {
  const rules = [
    ruleOf(1, { state: "awaiting_confirmation" }),
    ruleOf(2, { state: "deleted" }),
    ruleOf(3, { expiresAtMs: t0 }),
    ruleOf(4),
  ];
  const subject = await planted(harness, rules);
  const [waiting, deleted, expired, rotated] = rules;
  assert.ok(waiting && deleted && expired && rotated);
  await subject.plant({ ...rotated, secretHash: fixtureHash("a new secret") });
  const unknown = ruleOf(5);
  const kinds = await takeAll(
    subject,
    [waiting, deleted, expired, rotated, unknown].map((rule) => alertOf(rule)),
  );
  assert.deepEqual(kinds, ["gone", "gone", "gone", "gone", "gone"]);
  assert.equal(await alertsInInbox(subject), 0);
}

async function prunesEvents(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1, { ratePerMinute: 1 });
  const subject = await planted(harness, [rule]);
  await takeAll(subject, [
    alertOf(rule, { alertId: "a" }),
    alertOf(rule, { receivedAtMs: t0 + 5 }),
  ]);
  assert.equal(await subject.alerts.prune(t0 + 5, live()), 1);
  assert.equal(await subject.alerts.prune(t0 + 5, live()), 0);
  const again = await subject.alerts.take(
    alertOf(rule, { alertId: "a", receivedAtMs: t0 + 6 }),
    live(),
  );
  assert.equal(again.kind, "accepted");
}

// Event rows are never numbered again after a prune: an accepted alert's inbox entry is keyed on
// its row and outlives it.
async function numbersAfterAPrune(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1);
  const subject = await planted(harness, [rule]);
  const first = await subject.alerts.take(alertOf(rule), live());
  assert.equal(await subject.alerts.prune(t0 + 1, live()), 1);
  const next = await subject.alerts.take(alertOf(rule, { receivedAtMs: t0 + 2 }), live());
  assert.ok(first.kind === "accepted" && next.kind === "accepted");
  assert.notEqual(next.event, first.event);
  assert.equal(await alertsInInbox(subject), 2);
}

// An alert holding U+0000, in its body or its id, is refused before anything is stored
// (decision 0416).
async function refusesNulText(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1);
  const subject = await planted(harness, [rule]);
  const body = { text: withNul("BNBUSDT crossed 600") };
  await assertRefusesNulText(async () => subject.alerts.take(alertOf(rule, { body }), live()));
  const alertId = withNul("tv-1");
  await assertRefusesNulText(async () => subject.alerts.take(alertOf(rule, { alertId }), live()));
  assert.equal(await alertsInInbox(subject), 0);
  assert.equal(await subject.alerts.prune(t0 + 1, live()), 0);
}

async function refusesAborted(harness: WebhookAlertStoreHarness): Promise<void> {
  const rule = ruleOf(1);
  const subject = await planted(harness, [rule]);
  await assertRefusesAborted(async (options) => subject.alerts.findRule(rule.id, options));
  await assertRefusesAborted(async (options) => subject.alerts.take(alertOf(rule), options));
  await assertRefusesAborted(async (options) => subject.alerts.prune(t0, options));
  assert.equal(await alertsInInbox(subject), 0);
  assert.equal((await subject.alerts.take(alertOf(rule), live())).kind, "accepted");
}

/** The contract every `WebhookAlertStore` adapter passes. */
export function webhookAlertStoreContract(
  harness: WebhookAlertStoreHarness,
): readonly ContractCheck[] {
  const self = async (): Promise<WebhookAlertStoreHarness> => Promise.resolve(harness);
  return [
    checkOn("finds a rule by id in any state", self, findsRules),
    checkOn(
      "accepts an alert into the inbox with its rule, row, id and body",
      self,
      acceptsIntoInbox,
    ),
    checkOn("refuses the same id or body within ten minutes as a repeat", self, refusesRepeats),
    checkOn("refuses an alert past the rule's rate in any 60 seconds", self, holdsTheRate),
    checkOn("records nothing for a rule that is not answering", self, goneWhenNotAnswering),
    checkOn("prunes the rows received before a time", self, prunesEvents),
    checkOn("never numbers a row again after a prune", self, numbersAfterAPrune),
    checkOn("refuses an alert holding U+0000 and stores nothing", self, refusesNulText),
    checkOn("refuses every call on an aborted signal and stores nothing", self, refusesAborted),
  ];
}
