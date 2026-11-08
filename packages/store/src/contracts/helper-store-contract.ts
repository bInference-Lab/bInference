import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { HelperDraft } from "../chats/helper-record.js";
import type { HelperStore, SessionStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, nthSession, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh helper store on an empty agent database, with its session store and writer fence. */
export interface HelperStoreSubject {
  readonly store: HelperStore;
  readonly sessions: SessionStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface HelperStoreHarness {
  create(): Promise<HelperStoreSubject>;
}

// The `n`th helper of the first agent, started from its first session at `n` seconds.
function nthHelper(n: number): HelperDraft {
  return {
    id: nthId("ses", 100 + n),
    agentId: nthId("agt", 1),
    parentSessionId: nthId("ses", 1),
    label: `helper ${String(n)}`,
    startedAtMs: n * 1_000,
    timeoutMs: 600_000,
  };
}

async function withParent(subject: HelperStoreSubject, fence: number): Promise<void> {
  okValue(await subject.sessions.open({ ...nthSession(1), fence }, go()));
}

async function startsHelpers(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store, sessions } = subject;
  const draft = nthHelper(1);
  assert.deepEqual(await store.start({ ...draft, fence }, go()), {
    ok: false,
    error: "no_session",
  });
  await withParent(subject, fence);
  const started = { ...draft, state: "running", runs: 1, outside: false };
  assert.deepEqual(await store.start({ ...draft, fence }, go()), { ok: true, value: started });
  assert.deepEqual(await store.start({ ...draft, fence }, go()), { ok: false, error: "exists" });
  assert.deepEqual(await store.get(draft.id, go()), started);
  const session = await sessions.get(draft.id, go());
  assert.equal(session?.surface, "helper");
  assert.equal(session.agentId, draft.agentId);
  const named = { ...nthHelper(2), model: "openai/gpt-5" };
  assert.equal(okValue(await store.start({ ...named, fence }, go())).model, "openai/gpt-5");
  assert.equal(await store.get(nthId("ses", 99), go()), undefined);
}

async function movesHelpers(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withParent(subject, fence);
  const draft = nthHelper(1);
  okValue(await store.start({ ...draft, fence }, go()));
  const end = { helper: draft.id, from: "running", to: "done", atMs: 5_000, fence } as const;
  assert.deepEqual(await store.move({ ...end, from: "done", to: "running", timeoutMs: 1 }, go()), {
    ok: false,
    error: "stale",
  });
  const done = okValue(await store.move({ ...end, outside: true }, go()));
  assert.deepEqual([done.state, done.endedAtMs, done.outside], ["done", 5_000, true]);
  const again = { helper: draft.id, from: "done", to: "running", atMs: 6_000, fence } as const;
  const running = okValue(await store.move({ ...again, timeoutMs: 60_000 }, go()));
  assert.deepEqual(
    [running.state, running.endedAtMs, running.startedAtMs, running.runs, running.timeoutMs],
    ["running", undefined, 6_000, 2, 60_000],
  );
  const stopped = okValue(
    await store.move({ ...end, to: "stopped", atMs: 7_000, outside: false }, go()),
  );
  assert.deepEqual([stopped.state, stopped.outside], ["stopped", true]);
  const unknown = { ...end, helper: nthId("ses", 99) };
  assert.deepEqual(await store.move(unknown, go()), { ok: false, error: "not_found" });
}

async function refusesBadMoves(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withParent(subject, fence);
  const draft = nthHelper(1);
  okValue(await store.start({ ...draft, fence }, go()));
  const move = { helper: draft.id, from: "running", atMs: 5_000, fence } as const;
  await assert.rejects(store.move({ ...move, to: "running", timeoutMs: 1 }, go()));
  await assert.rejects(store.move({ ...move, to: "done", timeoutMs: 1 }, go()));
  assert.equal((await store.get(draft.id, go()))?.state, "running");
}

async function listsHelpers(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withParent(subject, fence);
  for (const n of [1, 2, 3]) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
    okValue(await store.start({ ...nthHelper(n), fence }, go()));
  }
  const end = { helper: nthHelper(2).id, from: "running", to: "failed", atMs: 9_000 } as const;
  okValue(await store.move({ ...end, fence }, go()));
  const all = await store.list({ agentId: nthId("agt", 1), limit: 10 }, go());
  assert.deepEqual(
    all.map((helper) => helper.label),
    ["helper 3", "helper 2", "helper 1"],
  );
  const running = await store.list({ state: "running", limit: 10 }, go());
  assert.deepEqual(
    running.map((helper) => helper.label),
    ["helper 3", "helper 1"],
  );
  assert.equal((await store.list({ agentId: nthId("agt", 1), limit: 1 }, go())).length, 1);
  assert.deepEqual(await store.list({ agentId: nthId("agt", 2), limit: 10 }, go()), []);
}

async function refusesStaleFence(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await withParent(subject, fence);
  const draft = nthHelper(1);
  okValue(await store.start({ ...draft, fence }, go()));
  await subject.fence.raise(go());
  assert.deepEqual(await store.start({ ...nthHelper(2), fence }, go()), {
    ok: false,
    error: "fenced",
  });
  const end = { helper: draft.id, from: "running", to: "done", atMs: 5_000, fence } as const;
  assert.deepEqual(await store.move(end, go()), { ok: false, error: "fenced" });
  assert.equal((await store.get(draft.id, go()))?.state, "running");
}

async function refusesAborted(subject: HelperStoreSubject, fence: number): Promise<void> {
  const { store } = subject;
  await rejectsAborted(async (options) => store.start({ ...nthHelper(1), fence }, options));
  await rejectsAborted(async (options) => store.get(nthId("ses", 101), options));
  await rejectsAborted(async (options) => store.list({ limit: 1 }, options));
  const end = { helper: nthId("ses", 101), from: "running", to: "done", atMs: 1, fence } as const;
  await rejectsAborted(async (options) => store.move(end, options));
}

/** The contract every `HelperStore` adapter passes. */
export function helperStoreContract(harness: HelperStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<HelperStoreSubject> => harness.create();
  return [
    fencedCheck("starts a helper once, in a session of its own", create, startsHelpers),
    fencedCheck("moves a helper from the state its mover read", create, movesHelpers),
    fencedCheck("refuses a move that neither ends a run nor starts one", create, refusesBadMoves),
    fencedCheck("lists helpers by agent and state, newest first", create, listsHelpers),
    fencedCheck("refuses every write made with a fence raised since", create, refusesStaleFence),
    fencedCheck("refuses every call on an aborted signal", create, refusesAborted),
  ];
}
