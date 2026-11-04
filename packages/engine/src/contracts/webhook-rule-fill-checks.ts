import assert from "node:assert/strict";
import type { IntentDraft } from "../intents/intent-record.js";
import { intentDraft, intentMove } from "./intent-fixtures.js";
import { fixtureId, live } from "./store-fixtures.js";
import {
  acceptedEvent,
  activeRule,
  ruleId,
  ruleMove,
  type WebhookRuleStoreSubject,
} from "./webhook-rule-fixtures.js";

// Intent `n`: a live fill the engine proposed under rule 1 for alert `event`, held by the executor.
function liveRuleFill(subject: WebhookRuleStoreSubject, n: number, event: number): IntentDraft {
  return {
    ...intentDraft(subject, n),
    isPaper: false,
    proposer: "engine",
    authorizedBy: { webhookRule: ruleId(1), event, fillsBefore: 0 },
    state: "executing",
  };
}

// The end of alert `event` that intent `n` writes, as a skip for `reason` or as a fill.
function endOf(n: number, event: number, reason?: "fill_lapsed" | "stuck_dropped") {
  const intentId = fixtureId("int", n);
  return reason === undefined
    ? { event, outcome: "filled" as const, intentId }
    : { event, outcome: "skipped" as const, reason, intentId };
}

/**
 * Checks that a live rule fill's move ends its alert with it (decision 0342): a skip with its
 * reason and the intent; a fill counted on its rule, or alone once the rule was deleted; never an
 * end naming another intent, nor a fill that skips its active rule's count.
 */
export async function endsALiveRuleFillsAlert(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  await activeRule(subject, 1);
  const lapsed = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const landed = await acceptedEvent(subject, { n: 1, atMs: 5_001 });
  assert.ok((await intents.create(liveRuleFill(subject, 7, lapsed), live())).ok);
  assert.ok((await intents.create(liveRuleFill(subject, 8, landed), live())).ok);
  const strange = { ...intentMove(7, 0, "failed_onchain"), alert: endOf(8, lapsed, "fill_lapsed") };
  await assert.rejects(intents.transition(strange, live()), { code: "store.constraint" });
  const uncounted = { ...intentMove(8, 0, "reconciled"), alert: endOf(8, landed) };
  await assert.rejects(intents.transition(uncounted, live()), { code: "store.constraint" });
  const skip = { ...intentMove(7, 0, "expired"), alert: endOf(7, lapsed, "fill_lapsed") };
  assert.ok((await intents.transition(skip, live())).ok);
  const ended = await store.alert(lapsed, live());
  assert.deepEqual(
    [ended?.outcome, ended?.reason, ended?.intentId],
    ["skipped", "fill_lapsed", fixtureId("int", 7)],
  );
  const rule = await store.get(ruleId(1), live());
  assert.ok(rule !== undefined);
  assert.ok((await store.move(ruleMove(1, rule.version, "deleted"), live())).ok);
  assert.ok((await intents.transition(uncounted, live())).ok);
  assert.equal((await store.alert(landed, live()))?.outcome, "filled");
  assert.equal((await store.get(ruleId(1), live()))?.fills, 0);
}

/**
 * Checks that a dropped rule fill that lands late turns its own `stuck_dropped` skip into its fill,
 * counted on its rule, in the landing's write (decision 0342); a landing of another intent over it
 * is `stale`, and writes nothing.
 */
export async function landsADroppedRuleFill(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  assert.ok((await intents.create(liveRuleFill(subject, 7, event), live())).ok);
  assert.ok((await intents.create(liveRuleFill(subject, 8, event), live())).ok);
  const drop = { ...intentMove(7, 0, "failed_onchain"), alert: endOf(7, event, "stuck_dropped") };
  assert.ok((await intents.transition(drop, live())).ok);
  const counted = { ...ruleMove(1, rule.version, "active"), fills: 1 };
  const landing = { txId: fixtureId("tx", 1), atMs: 9_000 };
  const stranger = { ...landing, intentId: fixtureId("int", 8) };
  const behind = { ...stranger, alert: { ...endOf(8, event), move: counted } };
  assert.deepEqual(await intents.recordLandedLate(behind, live()), { ok: false, error: "stale" });
  const own = { ...landing, intentId: fixtureId("int", 7) };
  const late = { ...own, alert: { ...endOf(7, event), move: counted } };
  assert.deepEqual(await intents.recordLandedLate(late, live()), { ok: true, value: late });
  const alert = await store.alert(event, live());
  assert.deepEqual(
    [alert?.outcome, alert?.reason, alert?.intentId],
    ["filled", undefined, own.intentId],
  );
  assert.equal((await store.get(ruleId(1), live()))?.fills, 1);
}

/**
 * Checks that a live rule fill holds its agent's line until its alert ends `filled` (decision
 * 0342), as an order's fill does until its order counts it.
 */
export async function holdsTheLineForARuleFill(subject: WebhookRuleStoreSubject): Promise<void> {
  const { intents } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  assert.ok((await intents.create(liveRuleFill(subject, 7, event), live())).ok);
  const query = { agentId: subject.agentId, droppedSinceMs: 0 };
  const held = await intents.fillsInFlight(query, live());
  assert.deepEqual(
    held.map(({ id }) => id),
    [fixtureId("int", 7)],
  );
  const counted = { ...ruleMove(1, rule.version, "active"), fills: 1 };
  const filled = { ...intentMove(7, 0, "finalized"), alert: { ...endOf(7, event), move: counted } };
  assert.ok((await intents.transition(filled, live())).ok);
  assert.deepEqual(await intents.fillsInFlight(query, live()), []);
}

/**
 * Checks that a live rule fill its reconciliation could not value counts on its alert and rule
 * alone, once it is `finalized` (decision 0342); a fill of an intent still under way, one
 * that skips its rule's count, or one counted on another rule, ends nothing alone.
 */
export async function countsAnUnvaluedRuleFill(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const finalized = { ...liveRuleFill(subject, 7, event), state: "finalized" as const };
  assert.ok((await intents.create(finalized, live())).ok);
  assert.ok((await intents.create(liveRuleFill(subject, 8, event), live())).ok);
  const counted = { ...ruleMove(1, rule.version, "active"), fills: 1 };
  const early = { ...endOf(8, event), move: counted };
  await assert.rejects(store.endAlert(early, live()), { code: "store.constraint" });
  await assert.rejects(store.endAlert(endOf(7, event), live()), { code: "store.constraint" });
  const other = await activeRule(subject, 2);
  const elsewhere = {
    ...endOf(7, event),
    move: { ...ruleMove(2, other.version, "active"), fills: 1 },
  };
  await assert.rejects(store.endAlert(elsewhere, live()), { code: "store.constraint" });
  const ended = await store.endAlert({ ...endOf(7, event), move: counted }, live());
  assert.deepEqual(ended.ok ? [ended.value.outcome, ended.value.intentId] : [], [
    "filled",
    fixtureId("int", 7),
  ]);
  assert.equal((await store.get(ruleId(1), live()))?.fills, 1);
}

/**
 * Checks that a page of a rule's fills holds only the alerts a fill ended, filled or failed on
 * chain, newest first, its limit counted after the rest are left out (decision 0342), so the
 * alerts skipped between fills never push a failure out of a rule's count.
 */
export async function pagesARuleFillsAlone(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  const reasons = ["reverted", "fill_waiting", "late", "stuck_dropped", "fill_waiting"] as const;
  const events = await reasons.reduce<Promise<readonly number[]>>(async (done, reason, index) => {
    const before = await done;
    const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 + index });
    const skip = { event, outcome: "skipped" as const, reason };
    assert.ok((await store.endAlert(skip, live())).ok);
    return [...before, event];
  }, Promise.resolve([]));
  const pageOf = async (limit: number) =>
    (await store.alerts({ ruleId: ruleId(1), limit, onlyFills: true }, live())).map(
      ({ event }) => event,
    );
  assert.deepEqual(await pageOf(10), [events[3], events[0]]);
  assert.deepEqual(await pageOf(1), [events[3]]);
  assert.equal((await store.alerts({ ruleId: ruleId(1), limit: 10 }, live())).length, 5);
}

/**
 * Checks that an alert whose live fill the executor holds ends only by that fill's own move
 * (decision 0342): a skip written alone, or one naming another intent, is `held` and writes
 * nothing; an unvalued count naming another alert's fill ends nothing; the fill's own move ends it.
 */
export async function keepsAHeldAlertForItsFill(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const rule = await activeRule(subject, 1);
  const event = await acceptedEvent(subject, { n: 1, atMs: 5_000 });
  const other = await acceptedEvent(subject, { n: 1, atMs: 5_001 });
  assert.ok((await intents.create(liveRuleFill(subject, 7, event), live())).ok);
  const elsewhere = { ...liveRuleFill(subject, 8, other), state: "finalized" as const };
  assert.ok((await intents.create(elsewhere, live())).ok);
  const late = { event, outcome: "skipped" as const, reason: "late" as const };
  assert.deepEqual(await store.endAlert(late, live()), { ok: false, error: "held" });
  const stranger = { ...late, intentId: fixtureId("int", 8) };
  assert.deepEqual(await store.endAlert(stranger, live()), { ok: false, error: "held" });
  const counted = { ...ruleMove(1, rule.version, "active"), fills: 1 };
  const borrowed = { ...endOf(8, event), move: counted };
  await assert.rejects(store.endAlert(borrowed, live()), { code: "store.constraint" });
  assert.equal((await store.alert(event, live()))?.outcome, undefined);
  const own = { ...intentMove(7, 0, "finalized"), alert: { ...endOf(7, event), move: counted } };
  assert.ok((await intents.transition(own, live())).ok);
  assert.equal((await store.alert(event, live()))?.intentId, fixtureId("int", 7));
}
