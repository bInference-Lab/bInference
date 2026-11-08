import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { GoalDraft, GoalState } from "../chats/goal-record.js";
import type { GoalStore, SessionStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, nthSession, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh goal store on an empty agent database, with its session store and writer fence. */
export interface GoalStoreSubject {
  readonly store: GoalStore;
  readonly sessions: SessionStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface GoalStoreHarness {
  create(): Promise<GoalStoreSubject>;
}

// A budget past what a 64-bit integer holds, so a column that kept less would fail.
const wideMicros = 2n ** 64n + 1n;

// The goal of the first session, set at 10 seconds.
const draft: GoalDraft = {
  sessionId: nthId("ses", 1),
  agentId: nthId("agt", 1),
  objective: "Find three tokens with steady volume",
  startedAtMs: 10_000,
};

const running: GoalState = {
  status: "active",
  spentMicros: wideMicros,
  goalTurns: 3,
  strikes: 1,
  updatedAtMs: 20_000,
};

async function withSession(subject: GoalStoreSubject, fence: number): Promise<void> {
  okValue(await subject.sessions.open({ ...nthSession(1), fence }, go()));
}

async function setsGoals(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  const budgeted = { ...draft, budgetMicros: wideMicros };
  assert.deepEqual(await store.set({ ...budgeted, fence }, go()), {
    ok: false,
    error: "no_session",
  });
  await withSession(subject, fence);
  const set = okValue(await store.set({ ...budgeted, fence }, go()));
  const expected = {
    ...budgeted,
    status: "active",
    spentMicros: 0n,
    goalTurns: 0,
    strikes: 0,
    updatedAtMs: 10_000,
    version: 0,
  };
  assert.deepEqual(set, expected);
  assert.deepEqual(await store.get(draft.sessionId, go()), expected);
  assert.deepEqual(await store.set({ ...draft, fence }, go()), { ok: false, error: "exists" });
  assert.equal(await store.get(nthId("ses", 9), go()), undefined);
}

async function writesGoals(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withSession(subject, fence);
  okValue(await store.set({ ...draft, fence }, go()));
  const write = { sessionId: draft.sessionId, version: 0, next: running, fence };
  const written = okValue(await store.write(write, go()));
  assert.deepEqual([written.spentMicros, written.goalTurns, written.version], [wideMicros, 3, 1]);
  assert.deepEqual(await store.write(write, go()), { ok: false, error: "stale" });
  const paused = { ...running, status: "paused", pauseReason: "owner", note: "wait" } as const;
  const pausedGoal = okValue(await store.write({ ...write, version: 1, next: paused }, go()));
  assert.deepEqual(
    [pausedGoal.status, pausedGoal.pauseReason, pausedGoal.note],
    ["paused", "owner", "wait"],
  );
  const resumed = okValue(await store.write({ ...write, version: 2, next: running }, go()));
  assert.deepEqual([resumed.pauseReason, resumed.note], [undefined, undefined]);
  const unknown = { ...write, sessionId: nthId("ses", 9) };
  assert.deepEqual(await store.write(unknown, go()), { ok: false, error: "not_found" });
}

async function refusesBadWrites(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withSession(subject, fence);
  okValue(await store.set({ ...draft, fence }, go()));
  const write = { sessionId: draft.sessionId, version: 0, fence };
  await assert.rejects(store.write({ ...write, next: { ...running, status: "paused" } }, go()));
  const reasoned = { ...running, pauseReason: "owner" };
  await assert.rejects(store.write({ ...write, next: reasoned }, go()));
  assert.equal((await store.get(draft.sessionId, go()))?.version, 0);
}

async function listsActiveGoals(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store, sessions } = subject;
  for (const n of [1, 2, 3]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    okValue(await sessions.open({ ...nthSession(n), fence }, go()));
  }
  for (const n of [3, 1, 2]) {
    const each = { ...draft, sessionId: nthId("ses", n), startedAtMs: n * 10_000, fence };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    okValue(await store.set(each, go()));
  }
  const pause = { ...running, status: "paused", pauseReason: "owner" } as const;
  okValue(await store.write({ sessionId: nthId("ses", 2), version: 0, next: pause, fence }, go()));
  const active = await store.active(go());
  assert.deepEqual(
    active.map((goal) => goal.sessionId),
    [nthId("ses", 1), nthId("ses", 3)],
  );
}

async function clearsGoals(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withSession(subject, fence);
  okValue(await store.set({ ...draft, fence }, go()));
  const clear = { sessionId: draft.sessionId, fence };
  assert.deepEqual(await store.clear(clear, go()), { ok: true, value: true });
  assert.deepEqual(await store.clear(clear, go()), { ok: true, value: false });
  assert.equal(await store.get(draft.sessionId, go()), undefined);
  okValue(await store.set({ ...draft, objective: "Again", fence }, go()));
}

async function keepsNotes(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  const note = {
    sessionId: draft.sessionId,
    agentId: draft.agentId,
    markdown: "**2 of 3** tokens checked",
    plan: [
      { text: "Scan", state: "done" },
      { text: "Check risk", state: "doing" },
    ],
    updatedAtMs: 30_000,
  } as const;
  assert.deepEqual(await store.putNote({ ...note, fence }, go()), {
    ok: false,
    error: "no_session",
  });
  await withSession(subject, fence);
  assert.deepEqual(okValue(await store.putNote({ ...note, fence }, go())), note);
  const replaced = { ...note, markdown: "", plan: [{ text: "Report", state: "todo" }] } as const;
  assert.deepEqual(okValue(await store.putNote({ ...replaced, fence }, go())), replaced);
  assert.deepEqual(await store.note(draft.sessionId, go()), replaced);
  const empty = { ...note, markdown: "", plan: [], fence };
  assert.deepEqual(await store.putNote(empty, go()), { ok: true, value: undefined });
  assert.equal(await store.note(draft.sessionId, go()), undefined);
}

async function refusesStaleFence(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withSession(subject, fence);
  okValue(await store.set({ ...draft, fence }, go()));
  await subject.fence.raise(go());
  const write = { sessionId: draft.sessionId, version: 0, next: running, fence };
  assert.deepEqual(await store.write(write, go()), { ok: false, error: "fenced" });
  const clear = { sessionId: draft.sessionId, fence };
  assert.deepEqual(await store.clear(clear, go()), { ok: false, error: "fenced" });
  const note = { ...draft, markdown: "x", plan: [], updatedAtMs: 1, fence };
  const { objective: _objective, startedAtMs: _started, ...put } = note;
  assert.deepEqual(await store.putNote(put, go()), { ok: false, error: "fenced" });
  assert.equal((await store.get(draft.sessionId, go()))?.version, 0);
}

async function refusesAborted(subject: GoalStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  const session = draft.sessionId;
  await rejectsAborted(async (options) => store.set({ ...draft, fence }, options));
  await rejectsAborted(async (options) => store.get(session, options));
  const write = { sessionId: session, version: 0, next: running, fence };
  await rejectsAborted(async (options) => store.write(write, options));
  await rejectsAborted(async (options) => store.clear({ sessionId: session, fence }, options));
  await rejectsAborted(async (options) => store.note(session, options));
  await rejectsAborted(async (options) => store.active(options));
}

/** The contract every `GoalStore` adapter passes. */
export function goalStoreContract(harness: GoalStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<GoalStoreSubject> => harness.create();
  return [
    fencedCheck("sets one goal per chat, with a budget past 64 bits", create, setsGoals),
    fencedCheck("writes a goal from the version its writer read", create, writesGoals),
    fencedCheck(
      "refuses a pause without a reason and a reason without a pause",
      create,
      refusesBadWrites,
    ),
    fencedCheck("lists the active goals, the oldest set first", create, listsActiveGoals),
    fencedCheck("clears a goal, so another may be set", create, clearsGoals),
    fencedCheck("replaces a progress note whole, and removes an empty one", create, keepsNotes),
    fencedCheck("refuses every write made with a fence raised since", create, refusesStaleFence),
    fencedCheck("refuses every call on an aborted signal", create, refusesAborted),
  ];
}
