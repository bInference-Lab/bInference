import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { IntentQuery } from "../intents/intent-change.js";
import { genesisLedgerHash } from "../ledger/ledger-hash.js";
import {
  closesWithMoves,
  confirmsOnce,
  refusesClosedCard,
  refusesTakenVersion,
} from "./intent-card-checks.js";
import {
  intentDraft,
  intentLedger,
  intentMove,
  type IntentStoreSubject,
} from "./intent-fixtures.js";
import { assertRefusesAborted, checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

/** Makes a fresh, empty intent store for each check. */
export interface IntentStoreHarness {
  create(): Promise<IntentStoreSubject>;
}

async function createsIntents(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  const draft = intentDraft(subject, 1);
  const created = await store.create(draft, live());
  assert.ok(created.ok);
  const { atMs, cause, ledger: ledgerDraft, ...fields } = draft;
  const { intent, event, ledgerEntry } = created.value;
  assert.deepEqual(intent, { ...fields, createdAtMs: atMs, changedAtMs: atMs, version: 0 });
  assert.deepEqual(event, { id: event.id, intentId: draft.id, toState: "proposed", cause, atMs });
  assert.deepEqual(ledgerEntry, {
    ...ledgerDraft,
    seq: 1,
    prevHash: genesisLedgerHash,
    hash: ledgerEntry?.hash,
  });
  assert.deepEqual(await store.get(draft.id, live()), intent);
  assert.deepEqual(await store.events(draft.id, live()), [event]);
  assert.deepEqual(await ledger.last(live()), ledgerEntry);
  assert.deepEqual(await store.create({ ...draft, ledger: intentLedger(1, 9, "x") }, live()), {
    ok: false,
    error: "exists",
  });
  assert.equal((await store.events(draft.id, live())).length, 1);
  assert.equal((await ledger.last(live()))?.seq, 1);
  assert.equal(await store.get(fixtureId("int", 9), live()), undefined);
}

async function movesUnderVersion(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  await store.create(intentDraft(subject, 1), live());
  const plan = { route: ["venue-a"] };
  const first = { ...intentMove(1, 0, "checked"), fields: { plan, quote: { minOut: "9" } } };
  const second = {
    ...intentMove(1, 1, "quoted"),
    fields: { risk: { verdict: "ok" } },
    ledger: intentLedger(1, 2, "quoted"),
  };
  assert.ok((await store.transition(first, live())).ok);
  const moved = await store.transition(second, live());
  assert.ok(moved.ok);
  const { intent, event, ledgerEntry } = moved.value;
  assert.deepEqual(
    { state: intent.state, version: intent.version, changedAtMs: intent.changedAtMs },
    { state: "quoted", version: 2, changedAtMs: second.atMs },
  );
  assert.deepEqual(
    [intent.plan, intent.quote, intent.risk],
    [plan, { minOut: "9" }, { verdict: "ok" }],
  );
  assert.deepEqual(intent.request, intentDraft(subject, 1).request);
  assert.deepEqual(
    { from: event.fromState, to: event.toState, cause: event.cause, at: event.atMs },
    { from: "checked", to: "quoted", cause: second.cause, at: second.atMs },
  );
  assert.deepEqual(await ledger.last(live()), ledgerEntry);
  assert.equal(ledgerEntry?.seq, 2);
  const failed = { ...intentMove(1, 2, "failed_check"), fields: { reason: "no_route" } } as const;
  const ended = await store.transition(failed, live());
  assert.ok(ended.ok);
  assert.deepEqual([ended.value.intent.reason, ended.value.intent.plan], ["no_route", plan]);
  const events = await store.events(intent.id, live());
  assert.deepEqual(
    events.map((item) => item.toState),
    ["proposed", "checked", "quoted", "failed_check"],
  );
}

async function refusesStale(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  await store.create(intentDraft(subject, 1), live());
  await store.transition(intentMove(1, 0, "checked"), live());
  const stale = { ...intentMove(1, 0, "cancelled"), ledger: intentLedger(1, 5, "cancelled") };
  assert.deepEqual(await store.transition(stale, live()), { ok: false, error: "stale" });
  const unknown = intentMove(9, 0, "checked");
  assert.deepEqual(await store.transition(unknown, live()), { ok: false, error: "not_found" });
  const stored = await store.get(fixtureId("int", 1), live());
  assert.deepEqual([stored?.state, stored?.version], ["checked", 1]);
  assert.equal((await store.events(fixtureId("int", 1), live())).length, 2);
  assert.equal((await ledger.last(live()))?.seq, 1);
}

async function letsOneRacerWin(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  await store.create(intentDraft(subject, 1), live());
  const outcomes = await Promise.all([
    store.transition(intentMove(1, 0, "cancelled"), live()),
    store.transition(intentMove(1, 0, "checked"), live()),
  ]);
  const refused = outcomes.filter((outcome) => !outcome.ok);
  assert.equal(outcomes.length - refused.length, 1);
  assert.deepEqual(refused, [{ ok: false, error: "stale" }]);
  const stored = await store.get(fixtureId("int", 1), live());
  assert.equal(stored?.version, 1);
  assert.equal((await store.events(fixtureId("int", 1), live())).length, 2);
}

async function listsByState(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const tied = { ...intentDraft(subject, 4), atMs: intentDraft(subject, 2).atMs };
  const drafts = [intentDraft(subject, 3), intentDraft(subject, 1), tied, intentDraft(subject, 2)];
  await inOrder(drafts, async (draft) => store.create(draft, live()));
  await store.transition(intentMove(1, 0, "checked"), live());
  const query = { states: ["proposed", "checked"] as const, limit: 2 };
  const firstPage = await store.list(query, live());
  assert.deepEqual(
    firstPage.map((intent) => intent.id),
    [fixtureId("int", 1), fixtureId("int", 2)],
  );
  const last = firstPage.at(-1);
  assert.ok(last !== undefined);
  const after = { changedAtMs: last.changedAtMs, id: last.id };
  const secondPage = await store.list({ ...query, after }, live());
  assert.deepEqual(
    secondPage.map((intent) => intent.id),
    [fixtureId("int", 4), fixtureId("int", 3)],
  );
  const proposed = await store.list({ states: ["proposed"], limit: 10 }, live());
  assert.equal(proposed.length, 3);
  const otherAgent = { ...query, agentId: fixtureId("agt", 99) };
  assert.deepEqual(await store.list(otherAgent, live()), []);
  await store.create({ ...intentDraft(subject, 5), isPaper: false }, live());
  const listed = async (byState: IntentQuery): Promise<readonly string[]> =>
    (await store.list(byState, live())).map((row) => row.id);
  const byMode = { states: ["proposed"], limit: 10 } as const;
  assert.deepEqual(await listed({ ...byMode, isPaper: false }), [fixtureId("int", 5)]);
  assert.deepEqual(await listed({ ...byMode, isPaper: true }), [
    fixtureId("int", 2),
    fixtureId("int", 4),
    fixtureId("int", 3),
  ]);
}

async function refusesAborted(subject: IntentStoreSubject): Promise<void> {
  const { store, ledger } = subject;
  const id = fixtureId("int", 1);
  await assertRefusesAborted(async (options) => store.create(intentDraft(subject, 1), options));
  await assertRefusesAborted(async (options) => store.get(id, options));
  await assertRefusesAborted(async (options) =>
    store.transition(intentMove(1, 0, "checked"), options),
  );
  await assertRefusesAborted(async (options) =>
    store.list({ states: ["proposed"], limit: 1 }, options),
  );
  await assertRefusesAborted(async (options) => store.events(id, options));
  await assertRefusesAborted(async (options) => store.cards(id, options));
  await assertRefusesAborted(async (options) => store.confirmation(id, options));
  assert.equal(await store.get(id, live()), undefined);
  assert.equal(await ledger.last(live()), undefined);
}

/** The contract every `IntentStore` adapter passes. */
export function intentStoreContract(harness: IntentStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<IntentStoreSubject> => harness.create();
  return [
    checkOn(
      "creates an intent with its first event and ledger entry, once",
      create,
      createsIntents,
    ),
    checkOn(
      "moves an intent under its version and keeps the parts set before",
      create,
      movesUnderVersion,
    ),
    checkOn("refuses a stale or unknown move and writes nothing", create, refusesStale),
    checkOn("lets exactly one of two racing moves from one version win", create, letsOneRacerWin),
    checkOn(
      "lists intents by state and mode, least recently changed first, page by page",
      create,
      listsByState,
    ),
    checkOn("opens, replaces and closes card versions with the moves", create, closesWithMoves),
    checkOn("records one confirmation with the move to confirmed", create, confirmsOnce),
    checkOn("refuses to close a card version that is not open", create, refusesClosedCard),
    checkOn("refuses a card version the intent already has", create, refusesTakenVersion),
    checkOn("refuses every call on an aborted signal and writes nothing", create, refusesAborted),
  ];
}
