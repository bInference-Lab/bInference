import assert from "node:assert/strict";
import { inOrder, live } from "./store-fixtures.js";
import {
  activeRule,
  ruleDraft,
  ruleId,
  takenAlert,
  type WebhookRuleStoreSubject,
} from "./webhook-rule-fixtures.js";

// The order of each ordered read the webhook rule store answers, pinned on rows of one millisecond
// written in an order their ids do not follow (database spec, section 6.7).

/** Checks that rules made in one millisecond list by id, a page at a time. */
export async function listsRulesOfOneInstantById(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await inOrder([3, 1, 2], async (n) =>
    store.create({ ...ruleDraft(subject, n), atMs: 700 }, live()),
  );
  const states = ["awaiting_confirmation"] as const;
  const listed = await store.list({ states, limit: 2 }, live());
  assert.deepEqual(
    listed.map(({ id }) => id),
    [ruleId(1), ruleId(2)],
  );
}

/**
 * Checks that a rule's alerts taken in one millisecond list the newest stored first, and their
 * notices wait to be announced in the order stored.
 */
export async function ordersAlertsOfOneInstant(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  const events = await inOrder(["c", "a", "b"], async (text) => {
    const taken = await takenAlert(subject, { n: 1, atMs: 5_000, text });
    assert.ok(taken.kind === "accepted" && taken.event !== undefined);
    return taken.event;
  });
  const newestFirst = events.toReversed();
  const alerts = await store.alerts({ ruleId: ruleId(1), limit: 10 }, live());
  assert.deepEqual(
    alerts.map(({ event }) => event),
    newestFirst,
  );
  const page = await store.events({ ruleId: ruleId(1), limit: 2 }, live());
  assert.deepEqual(
    page.map(({ event }) => event),
    newestFirst.slice(0, 2),
  );
  const notices = [{ key: "notice.fill", values: {} }];
  await inOrder(newestFirst, async (event) =>
    store.endAlert({ event, outcome: "skipped", reason: "late", notices }, live()),
  );
  const due = await store.unannounced(10, live());
  assert.deepEqual(
    due.map(({ event }) => event),
    events,
  );
}
