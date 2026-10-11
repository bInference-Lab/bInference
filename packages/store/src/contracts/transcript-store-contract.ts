import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { EventDraft } from "../chats/transcript-event.js";
import type { SessionStore, TranscriptStore, WriterFence } from "../ports.js";
import { fencedCheck, go, nthId, nthSession, okValue, rejectsAborted } from "./agent-fixtures.js";

/** A fresh transcript store on an empty agent database, with its sessions and writer fence. */
export interface TranscriptStoreSubject {
  readonly store: TranscriptStore;
  readonly sessions: SessionStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface TranscriptStoreHarness {
  create(): Promise<TranscriptStoreSubject>;
}

function said(text: string, atMs: number): EventDraft {
  return { role: "owner", kind: "text", content: { text }, outside: false, atMs };
}

// Two sessions of the first agent, and a turn in the first.
async function plant(subject: TranscriptStoreSubject, fence: number): Promise<void> {
  await subject.sessions.open({ ...nthSession(1), fence }, go());
  await subject.sessions.open({ ...nthSession(2), fence }, go());
  const turn = { id: nthId("trn", 1), sessionId: nthId("ses", 1), startedAtMs: 1 };
  await subject.sessions.startTurn({ ...turn, outsideContent: false, fence }, go());
}

async function appendsInOrder(subject: TranscriptStoreSubject, fence: number): Promise<void> {
  await plant(subject, fence);
  const { store } = subject;
  const sessionId = nthId("ses", 1);
  const call = {
    turnId: nthId("trn", 1),
    role: "agent",
    kind: "tool_call",
    content: { tool: "quote", args: { amount: "18446744073709551617" } },
    outside: false,
    atMs: 3,
  } as const;
  const first = okValue(await store.append({ sessionId, events: [said("hi", 1)], fence }, go()));
  const result = { ...call, kind: "tool_result", content: "page text", outside: true } as const;
  const more = okValue(await store.append({ sessionId, events: [call, result], fence }, go()));
  await store.append({ sessionId: nthId("ses", 2), events: [said("other", 2)], fence }, go());
  assert.deepEqual(
    [...first, ...more].map(({ seq, kind, outside }) => [seq, kind, outside]),
    [
      [1, "text", false],
      [2, "tool_call", false],
      [3, "tool_result", true],
    ],
  );
  const read = await store.events({ sessionId, limit: 10 }, go());
  assert.deepEqual(read, [...first, ...more]);
  assert.deepEqual(read[1]?.content, call.content);
  assert.deepEqual(await store.events({ sessionId, afterSeq: 1, limit: 1 }, go()), [more[0]]);
  const other = await store.events({ sessionId: nthId("ses", 2), limit: 10 }, go());
  assert.deepEqual(
    other.map(({ seq, sessionId: session }) => [seq, session]),
    [[1, nthId("ses", 2)]],
  );
}

async function commitsWithItsEvents(subject: TranscriptStoreSubject, fence: number): Promise<void> {
  await plant(subject, fence);
  const { store, sessions } = subject;
  const [sessionId, first, second] = [nthId("ses", 1), nthId("trn", 1), nthId("trn", 2)];
  const draft = { id: second, sessionId, startedAtMs: 2, outsideContent: false };
  await sessions.startTurn({ ...draft, fence }, go());
  const call = { ...said("swap", 3), role: "agent", kind: "tool_call", turnId: first } as const;
  const noTurn = { ok: false, error: "no_turn" };
  const stray = { sessionId, turn: second, events: [call], fence };
  assert.deepEqual(await store.appendCommitting(stray, go()), noTurn);
  const elsewhere = { sessionId: nthId("ses", 2), turn: first, events: [call], fence };
  assert.deepEqual(await store.appendCommitting(elsewhere, go()), noTurn);
  assert.equal((await sessions.turn(second, go()))?.committed, false);
  const events = [{ ...said("buy it", 2), turnId: first }, call];
  const written = okValue(
    await store.appendCommitting({ sessionId, turn: first, events, fence }, go()),
  );
  assert.deepEqual(
    written.map(({ seq, kind }) => [seq, kind]),
    [
      [1, "text"],
      [2, "tool_call"],
    ],
  );
  assert.equal((await sessions.turn(first, go()))?.committed, true);
  await sessions.endTurn({ turn: second, atMs: 4, outcome: "ok", heldBack: 0, fence }, go());
  const late = { sessionId, turn: second, events: [{ ...call, turnId: second }], fence };
  assert.deepEqual(await store.appendCommitting(late, go()), { ok: false, error: "ended" });
  assert.deepEqual(await store.events({ sessionId, limit: 10 }, go()), written);
}

async function refusesStrangers(subject: TranscriptStoreSubject, fence: number): Promise<void> {
  await plant(subject, fence);
  const { store } = subject;
  const unknownSession = { sessionId: nthId("ses", 9), events: [said("hi", 1)], fence };
  assert.deepEqual(await store.append(unknownSession, go()), { ok: false, error: "no_session" });
  const strayTurn = { ...said("hi", 1), turnId: nthId("trn", 1) };
  const otherSession = { sessionId: nthId("ses", 2), events: [said("a", 1), strayTurn], fence };
  assert.deepEqual(await store.append(otherSession, go()), { ok: false, error: "no_turn" });
  const unknownTurn = { ...said("hi", 1), turnId: nthId("trn", 9) };
  const append = { sessionId: nthId("ses", 1), events: [unknownTurn], fence };
  assert.deepEqual(await store.append(append, go()), { ok: false, error: "no_turn" });
  assert.deepEqual(await store.events({ sessionId: nthId("ses", 2), limit: 10 }, go()), []);
}

async function refusesStaleFence(subject: TranscriptStoreSubject, old: number): Promise<void> {
  await plant(subject, old);
  const sessionId = nthId("ses", 1);
  await subject.fence.raise(go());
  assert.deepEqual(
    await subject.store.append({ sessionId, events: [said("late", 9)], fence: old }, go()),
    { ok: false, error: "fenced" },
  );
  const call = { ...said("late", 9), turnId: nthId("trn", 1) };
  const committing = { sessionId, turn: nthId("trn", 1), events: [call], fence: old };
  assert.deepEqual(await subject.store.appendCommitting(committing, go()), {
    ok: false,
    error: "fenced",
  });
  assert.equal((await subject.sessions.turn(nthId("trn", 1), go()))?.committed, false);
  assert.deepEqual(await subject.store.events({ sessionId, limit: 10 }, go()), []);
}

async function refusesAborted(subject: TranscriptStoreSubject, fence: number): Promise<void> {
  await plant(subject, fence);
  const { store } = subject;
  const sessionId = nthId("ses", 1);
  const append = { sessionId, events: [said("hi", 1)], fence };
  await rejectsAborted(async (options) => store.append(append, options));
  const call = { ...said("hi", 1), turnId: nthId("trn", 1) };
  const committing = { sessionId, turn: nthId("trn", 1), events: [call], fence };
  await rejectsAborted(async (options) => store.appendCommitting(committing, options));
  await rejectsAborted(async (options) => store.events({ sessionId, limit: 1 }, options));
  assert.deepEqual(await store.events({ sessionId, limit: 10 }, go()), []);
}

/** The contract every `TranscriptStore` adapter passes. */
export function transcriptStoreContract(harness: TranscriptStoreHarness): readonly ContractCheck[] {
  const create = async (): Promise<TranscriptStoreSubject> => harness.create();
  return [
    fencedCheck(
      "numbers each session's events in order and reads them back",
      create,
      appendsInOrder,
    ),
    fencedCheck(
      "writes a turn's events with its committed mark, or neither",
      create,
      commitsWithItsEvents,
    ),
    fencedCheck("refuses events of a session or a turn it does not hold", create, refusesStrangers),
    fencedCheck("refuses an append made with a fence raised since", create, refusesStaleFence),
    fencedCheck(
      "refuses every call on an aborted signal and writes nothing",
      create,
      refusesAborted,
    ),
  ];
}
