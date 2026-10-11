import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { TurnDraft } from "../chats/turn-record.js";
import type { SessionStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, nthSession, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh session store on an empty agent database, with that database's writer fence. */
export interface SessionStoreSubject {
  readonly store: SessionStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface SessionStoreHarness {
  create(): Promise<SessionStoreSubject>;
}

function nthTurn(n: number, session = 1): TurnDraft {
  return {
    id: nthId("trn", n),
    sessionId: nthId("ses", session),
    startedAtMs: 10_000 + n,
    outsideContent: false,
  };
}

async function keepsSessions({ store }: SessionStoreSubject, fence: number): Promise<void> {
  const draft = nthSession(1);
  assert.deepEqual(await store.open({ ...draft, fence }, go()), {
    ok: true,
    value: { ...draft, version: 0 },
  });
  assert.deepEqual(await store.open({ ...nthSession(1), fence }, go()), {
    ok: false,
    error: "exists",
  });
  assert.deepEqual(await store.get(draft.id, go()), { ...draft, version: 0 });
  assert.equal(await store.get(nthId("ses", 9), go()), undefined);
}

async function closesSessions({ store }: SessionStoreSubject, fence: number): Promise<void> {
  const draft = nthSession(1);
  await store.open({ ...draft, fence }, go());
  const close = { session: draft.id, atMs: 5_000, version: 0, fence };
  assert.deepEqual(await store.close({ ...close, version: 1 }, go()), {
    ok: false,
    error: "stale",
  });
  const closed = { ...draft, clearedAtMs: 5_000, version: 1 };
  assert.deepEqual(await store.close(close, go()), { ok: true, value: closed });
  assert.deepEqual(await store.close({ ...close, version: 1 }, go()), {
    ok: false,
    error: "closed",
  });
  const unknown = { ...close, session: nthId("ses", 9) };
  assert.deepEqual(await store.close(unknown, go()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.get(draft.id, go()), closed);
}

async function startsTurns({ store }: SessionStoreSubject, fence: number): Promise<void> {
  assert.deepEqual(await store.startTurn({ ...nthTurn(1), fence }, go()), {
    ok: false,
    error: "no_session",
  });
  await store.open({ ...nthSession(1), fence }, go());
  const withModel = { ...nthTurn(1), model: "router/main", outsideContent: true };
  const started = { ...withModel, committed: false, heldBack: 0 };
  assert.deepEqual(await store.startTurn({ ...withModel, fence }, go()), {
    ok: true,
    value: started,
  });
  assert.deepEqual(await store.startTurn({ ...nthTurn(1), fence }, go()), {
    ok: false,
    error: "exists",
  });
  assert.deepEqual(await store.turn(nthId("trn", 1), go()), started);
  assert.equal(await store.turn(nthId("trn", 9), go()), undefined);
}

async function marksTurns({ store }: SessionStoreSubject, fence: number): Promise<void> {
  await store.open({ ...nthSession(1), fence }, go());
  await store.startTurn({ ...nthTurn(1), fence }, go());
  const turn = { turn: nthId("trn", 1), fence };
  await store.commitTurn(turn, go());
  const committed = okValue(await store.commitTurn(turn, go()));
  assert.deepEqual([committed.committed, committed.outsideContent], [true, false]);
  await store.markOutside(turn, go());
  const marked = okValue(await store.markOutside(turn, go()));
  assert.deepEqual([marked.committed, marked.outsideContent], [true, true]);
  const unknown = { turn: nthId("trn", 9), fence };
  assert.deepEqual(await store.commitTurn(unknown, go()), { ok: false, error: "not_found" });
  assert.deepEqual(await store.markOutside(unknown, go()), { ok: false, error: "not_found" });
}

async function endsTurns({ store }: SessionStoreSubject, fence: number): Promise<void> {
  await store.open({ ...nthSession(1), fence }, go());
  await store.startTurn({ ...nthTurn(2), fence }, go());
  await store.startTurn({ ...nthTurn(1), fence }, go());
  await store.startTurn({ ...nthTurn(3), fence }, go());
  const end = { turn: nthId("trn", 1), atMs: 20_000, outcome: "ok", heldBack: 2, fence } as const;
  const ended = { ...nthTurn(1), committed: false, heldBack: 2, endedAtMs: 20_000, outcome: "ok" };
  assert.deepEqual(await store.endTurn(end, go()), { ok: true, value: ended });
  assert.deepEqual(await store.endTurn({ ...end, outcome: "failed" }, go()), {
    ok: false,
    error: "ended",
  });
  const turn = { turn: end.turn, fence };
  assert.deepEqual(await store.commitTurn(turn, go()), { ok: false, error: "ended" });
  assert.deepEqual(await store.markOutside(turn, go()), { ok: false, error: "ended" });
  const unknown = { ...end, turn: nthId("trn", 9) };
  assert.deepEqual(await store.endTurn(unknown, go()), { ok: false, error: "not_found" });
  const open = await store.unfinishedTurns(go());
  assert.deepEqual(
    open.map((turnRecord) => turnRecord.id),
    [nthId("trn", 2), nthId("trn", 3)],
  );
}

async function refusesStaleFence(subject: SessionStoreSubject, old: number): Promise<void> {
  const { store } = subject;
  await store.open({ ...nthSession(1), fence: old }, go());
  await store.startTurn({ ...nthTurn(1), fence: old }, go());
  const fence = await subject.fence.raise(go());
  const fenced = { ok: false, error: "fenced" };
  assert.deepEqual(await store.open({ ...nthSession(2), fence: old }, go()), fenced);
  const close = { session: nthId("ses", 1), atMs: 1, version: 0, fence: old };
  assert.deepEqual(await store.close(close, go()), fenced);
  assert.deepEqual(await store.startTurn({ ...nthTurn(2), fence: old }, go()), fenced);
  const turn = { turn: nthId("trn", 1), fence: old };
  assert.deepEqual(await store.commitTurn(turn, go()), fenced);
  assert.deepEqual(await store.markOutside(turn, go()), fenced);
  const end = { ...turn, atMs: 1, outcome: "ok", heldBack: 0 } as const;
  assert.deepEqual(await store.endTurn(end, go()), fenced);
  assert.equal(await store.get(nthId("ses", 2), go()), undefined);
  assert.deepEqual(await store.turn(nthId("trn", 1), go()), {
    ...nthTurn(1),
    committed: false,
    heldBack: 0,
  });
  assert.equal((await store.endTurn({ ...end, fence }, go())).ok, true);
}

async function refusesAborted({ store }: SessionStoreSubject, fence: number): Promise<void> {
  await rejectsAborted(async (options) => store.open({ ...nthSession(1), fence }, options));
  await rejectsAborted(async (options) => store.get(nthId("ses", 1), options));
  const close = { session: nthId("ses", 1), atMs: 1, version: 0, fence };
  await rejectsAborted(async (options) => store.close(close, options));
  await rejectsAborted(async (options) => store.startTurn({ ...nthTurn(1), fence }, options));
  const turn = { turn: nthId("trn", 1), fence };
  await rejectsAborted(async (options) => store.commitTurn(turn, options));
  await rejectsAborted(async (options) => store.markOutside(turn, options));
  const end = { ...turn, atMs: 1, outcome: "ok", heldBack: 0 } as const;
  await rejectsAborted(async (options) => store.endTurn(end, options));
  await rejectsAborted(async (options) => store.turn(nthId("trn", 1), options));
  await rejectsAborted(async (options) => store.unfinishedTurns(options));
  assert.equal(await store.get(nthId("ses", 1), go()), undefined);
}

/** The contract every `SessionStore` adapter passes. */
export function sessionStoreContract(harness: SessionStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<SessionStoreSubject> => harness.create();
  return [
    fencedCheck("opens a session once and reads it back", create, keepsSessions),
    fencedCheck("closes a session once, at the version its closer read", create, closesSessions),
    fencedCheck("starts a turn once, in a session it holds", create, startsTurns),
    fencedCheck("sets a turn's committed and outside marks, which never clear", create, marksTurns),
    fencedCheck("ends a turn once and lists the turns that never ended", create, endsTurns),
    fencedCheck("refuses every write made with a fence raised since", create, refusesStaleFence),
    fencedCheck(
      "refuses every call on an aborted signal and writes nothing",
      create,
      refusesAborted,
    ),
  ];
}
