import assert from "node:assert/strict";
import type { FreezeWrite } from "../intents/freeze-write.js";
import { maxWebhookRulesPerAgent } from "../webhooks/webhook-rule-record.js";
import { agentVersion, confirmedCard } from "./order-fixtures.js";
import { assertReadBack, fixtureHash, fixtureId, inOrder, live } from "./store-fixtures.js";
import {
  acceptedEvent,
  activeRule,
  ruleDraft,
  ruleId,
  ruleMove,
  ruleSecretHash,
  type WebhookRuleStoreSubject,
} from "./webhook-rule-fixtures.js";

/** Checks that a new rule is stored awaiting its card, read back by id and by its intent. */
export async function createsRules(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  const draft = ruleDraft(subject, 1);
  const created = await store.create(draft, live());
  assert.ok(created.ok);
  const { atMs, secretHash: _secretHash, ...fields } = draft;
  const expected = {
    ...fields,
    state: "awaiting_confirmation",
    fills: 0,
    urlChangedAtMs: atMs,
    oldUrlLastEvent: 0,
    createdAtMs: atMs,
    changedAtMs: atMs,
    version: 0,
  };
  assert.deepEqual(created.value, expected);
  await assertReadBack(store, draft, created.value);
  assert.deepEqual(await store.create(draft, live()), { ok: false, error: "exists" });
  assert.equal(await store.get(ruleId(9), live()), undefined);
  assert.equal(await store.byIntent(fixtureId("int", 9), live()), undefined);
  const key = await subject.alerts.findRule(draft.id, live());
  assert.equal(key?.secretHash, draft.secretHash);
  assert.equal(key.state, "awaiting_confirmation");
}

/** Checks that a rule of another agent's wallet, or of no agent, throws. */
export async function refusesStrangers(subject: WebhookRuleStoreSubject): Promise<void> {
  const foreign = { ...ruleDraft(subject, 1), walletId: subject.other.walletId };
  await assert.rejects(subject.store.create(foreign, live()), { code: "store.constraint" });
  assert.equal(await subject.store.get(foreign.id, live()), undefined);
}

/** Checks that an agent holds 20 rules active or awaiting their card, and a deleted one frees one. */
export async function holdsTwentyRules(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  const held = Array.from({ length: maxWebhookRulesPerAgent }, (_, index) => index + 1);
  await inOrder(held, async (n) =>
    assert.ok((await store.create(ruleDraft(subject, n), live())).ok),
  );
  const extra = ruleDraft(subject, 21);
  assert.deepEqual(await store.create(extra, live()), { ok: false, error: "too_many" });
  const other = { ...ruleDraft(subject.other, 22) };
  assert.ok((await store.create(other, live())).ok);
  assert.ok((await store.move(ruleMove(1, 0, "deleted"), live())).ok);
  assert.ok((await store.create(extra, live())).ok);
}

/** Checks that a rule is active only on its card's confirmation, under the version it read. */
export async function activatesOnTheConfirmedCard(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(ruleDraft(subject, 1), live());
  const unconfirmed = { ...ruleMove(1, 0, "active"), cardId: fixtureId("crd", 11) };
  assert.deepEqual(await store.move(unconfirmed, live()), { ok: false, error: "not_confirmed" });
  assert.deepEqual(await store.move(ruleMove(1, 0, "active"), live()), {
    ok: false,
    error: "not_confirmed",
  });
  const cardId = await confirmedCard(subject, 1);
  const stale = { ...ruleMove(1, 3, "active"), cardId };
  assert.deepEqual(await store.move(stale, live()), { ok: false, error: "stale" });
  const moved = await store.move({ ...ruleMove(1, 0, "active"), cardId }, live());
  assert.ok(moved.ok);
  assert.deepEqual(
    { state: moved.value.state, cardId: moved.value.cardId, version: moved.value.version },
    { state: "active", cardId, version: 1 },
  );
  assert.equal((await subject.alerts.findRule(ruleId(1), live()))?.state, "active");
  assert.deepEqual(await store.move(ruleMove(9, 0, "deleted"), live()), {
    ok: false,
    error: "not_found",
  });
}

/**
 * Checks that a frozen agent's rule never moves into `active` and takes no new rule, while one
 * already active keeps counting its fills.
 */
export async function refusesAFrozenAgentsRule(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store, intents } = subject;
  const active = await activeRule(subject, 3);
  const cardId = await confirmedCard(subject, 1);
  await store.create(ruleDraft(subject, 1), live());
  const expectedVersion = await agentVersion(subject, subject.agentId);
  const frozen: FreezeWrite = {
    atMs: 2_000,
    isFrozen: true,
    orders: [],
    agents: [{ agentId: subject.agentId, expectedVersion }],
    isWholeInstall: false,
    moves: [],
    ledger: [],
  };
  assert.ok((await intents.freeze(frozen, live())).ok);
  const activation = { ...ruleMove(1, 0, "active"), cardId };
  assert.deepEqual(await store.move(activation, live()), { ok: false, error: "frozen" });
  assert.deepEqual(await store.create(ruleDraft(subject, 2), live()), {
    ok: false,
    error: "frozen",
  });
  const counted = { ...ruleMove(3, active.version, "active"), fills: 1 };
  assert.equal((await store.move(counted, live())).ok, true);
}

/** Checks that a rotation changes the hash the listener reads, and when the URL changed. */
export async function rotatesTheUrl(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  const active = await activeRule(subject, 1);
  const before = await acceptedEvent(subject, { n: 1, atMs: 4_000 });
  const secretHash = fixtureHash("a new secret");
  const rotation = { ...ruleMove(1, active.version, "active"), atMs: 4_000, secretHash };
  const rotated = await store.move(rotation, live());
  assert.ok(rotated.ok);
  assert.equal(rotated.value.urlChangedAtMs, 4_000);
  assert.equal(rotated.value.oldUrlLastEvent, before);
  assert.equal(rotated.value.cardId, active.cardId);
  const key = await subject.alerts.findRule(ruleId(1), live());
  assert.equal(key?.secretHash, secretHash);
  assert.notEqual(key.secretHash, ruleSecretHash(1));
  const counted = { ...ruleMove(1, 2, "active"), fills: 2 };
  const fills = await store.move(counted, live());
  assert.ok(fills.ok);
  assert.deepEqual([fills.value.fills, fills.value.urlChangedAtMs], [2, 4_000]);
}

/** Checks that rules are listed by state and agent, the oldest first, at most the limit. */
export async function listsRules(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await inOrder([1, 2, 3], async (n) => store.create(ruleDraft(subject, n), live()));
  await store.create(ruleDraft(subject.other, 4), live());
  await store.move(ruleMove(2, 0, "deleted"), live());
  const ids = async (query: Parameters<typeof store.list>[0]) =>
    (await store.list(query, live())).map(({ id }) => id);
  const waiting = ["awaiting_confirmation"] as const;
  assert.deepEqual(await ids({ states: waiting, limit: 10 }), [ruleId(1), ruleId(3), ruleId(4)]);
  const own = { states: waiting, agentId: subject.agentId, limit: 10 };
  assert.deepEqual(await ids(own), [ruleId(1), ruleId(3)]);
  assert.deepEqual(await ids({ states: ["deleted"], limit: 10 }), [ruleId(2)]);
  assert.deepEqual(await ids({ states: waiting, limit: 1 }), [ruleId(1)]);
}

/** Checks that a deleted rule never moves again, and its URL answers nothing. */
export async function neverMovesADeletedRule(subject: WebhookRuleStoreSubject): Promise<void> {
  const { store } = subject;
  await activeRule(subject, 1);
  assert.ok((await store.move(ruleMove(1, 1, "deleted"), live())).ok);
  assert.equal((await subject.alerts.findRule(ruleId(1), live()))?.state, "deleted");
  await assert.rejects(store.move(ruleMove(1, 2, "active"), live()), {
    code: "store.constraint",
  });
}
