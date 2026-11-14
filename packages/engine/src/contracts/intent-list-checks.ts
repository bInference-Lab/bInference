import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { IntentQuery } from "../intents/intent-change.js";
import type { IntentState } from "../intents/intent-state.js";
import { statesBeforeCard } from "../intents/transition-table.js";
import { cardOf, intentDraft, intentMove, type IntentStoreSubject } from "./intent-fixtures.js";
import { checkOn, fixtureId, inOrder, live } from "./store-fixtures.js";

// How the intent store lists intents: by state, mode and change time, page by page.

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

async function listsChangedSince(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const drafts = [intentDraft(subject, 1), intentDraft(subject, 2), intentDraft(subject, 3)];
  await inOrder(drafts, async (draft) => store.create(draft, live()));
  const since = intentDraft(subject, 2).atMs;
  const query = { states: ["proposed"], limit: 10 } as const;
  const listed = async (changedSinceMs: number): Promise<readonly string[]> =>
    (await store.list({ ...query, changedSinceMs }, live())).map((row) => row.id);
  assert.deepEqual(await listed(since), [fixtureId("int", 2), fixtureId("int", 3)]);
  assert.deepEqual(await listed(since + 1), [fixtureId("int", 3)]);
  const moved = await store.transition(intentMove(3, 0, "checked"), live());
  assert.ok(moved.ok);
  const changed = await store.list(
    { states: ["proposed", "checked"], limit: 10, changedSinceMs: 3_001 },
    live(),
  );
  assert.deepEqual(
    changed.map((row) => row.id),
    [fixtureId("int", 3)],
  );
}

// Intent `n`, live or paper by turns, stored in each state before its card and in three past it,
// as the start's end of the proposals a stop left reads them (decision 0444): those five come
// back in both modes, page by page, and none at its card or past it.
async function listsBeforeCard(subject: IntentStoreSubject): Promise<void> {
  const { store } = subject;
  const states: readonly IntentState[] = [
    ...statesBeforeCard,
    "awaiting_confirmation",
    "confirmed",
    "cancelled",
  ];
  await inOrder([...states.keys()], async (index) => {
    const n = index + 1;
    const state = states[index];
    assert.ok(state !== undefined);
    await store.create({ ...intentDraft(subject, n), isPaper: n % 2 === 0 }, live());
    const card = state === "awaiting_confirmation" ? { openCard: cardOf(n, 1) } : {};
    const moved = await store.transition({ ...intentMove(n, 0, state), ...card }, live());
    assert.ok(moved.ok);
  });
  const query = { states: statesBeforeCard, limit: 3 };
  const first = await store.list(query, live());
  const last = first.at(-1);
  assert.ok(last !== undefined);
  const after = { changedAtMs: last.changedAtMs, id: last.id };
  const second = await store.list({ ...query, after }, live());
  assert.deepEqual(
    [...first, ...second].map(({ id, state, isPaper }) => ({ id, state, isPaper })),
    statesBeforeCard.map((state, index) => ({
      id: fixtureId("int", index + 1),
      state,
      isPaper: (index + 1) % 2 === 0,
    })),
  );
}

/** The intent store's list checks, each on a fresh store from `create`. */
export function intentListChecks(
  create: () => Promise<IntentStoreSubject>,
): readonly ContractCheck[] {
  return [
    checkOn(
      "lists intents by state and mode, least recently changed first, page by page",
      create,
      listsByState,
    ),
    checkOn("lists the intents changed at or after a time", create, listsChangedSince),
    checkOn(
      "lists every intent before its card, live and paper, and none at or past it",
      create,
      listsBeforeCard,
    ),
  ];
}
