import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { EventDraft } from "../chats/transcript-event.js";
import type {
  ChatQueueStore,
  ChatRetention,
  SessionStore,
  TranscriptStore,
  WriterFence,
} from "../ports.js";
import { fencedCheck, go, nthId, nthSession, rejectsAborted } from "./agent-fixtures.js";

/** Chat retention on an empty agent database, with the stores that fill it and its fence. */
export interface ChatRetentionSubject {
  readonly retention: ChatRetention;
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly queue: ChatQueueStore;
  readonly fence: WriterFence;
}

/** Makes a fresh subject for each check. */
export interface ChatRetentionHarness {
  create(): Promise<ChatRetentionSubject>;
}

const sessionId = nthId("ses", 1);
const cutoff = 1_000;

// Turn n starts at `startedAtMs`, ends at `endedAtMs` unless it runs, and says one thing at
// `saidAtMs` unless it said nothing.
async function plantTurn(
  subject: ChatRetentionSubject,
  fence: number,
  turn: { readonly n: number; readonly endedAtMs?: number; readonly saidAtMs?: number },
): Promise<void> {
  const id = nthId("trn", turn.n);
  await subject.sessions.startTurn(
    { id, sessionId, startedAtMs: 1, outsideContent: false, fence },
    go(),
  );
  if (turn.saidAtMs !== undefined) {
    const event = {
      turnId: id,
      role: "agent",
      kind: "text",
      content: "hi",
      outside: false,
    } as const;
    await subject.transcript.append(
      { sessionId, events: [{ ...event, atMs: turn.saidAtMs }], fence },
      go(),
    );
  }
  if (turn.endedAtMs !== undefined) {
    const end = { turn: id, atMs: turn.endedAtMs, outcome: "ok", heldBack: 0, fence } as const;
    await subject.sessions.endTurn(end, go());
  }
}

async function plantMessage(
  subject: ChatRetentionSubject,
  fence: number,
  message: { readonly n: number; readonly atMs: number },
) {
  const id = nthId("msg", message.n);
  const draft = {
    message: id,
    agentId: nthId("agt", 1),
    sessionId,
    kind: "inbox/message",
    payload: {},
    receivedAtMs: message.atMs,
  } as const;
  await subject.queue.add({ ...draft, fence }, go());
  return id;
}

async function prunesOldChats(subject: ChatRetentionSubject, fence: number): Promise<void> {
  await subject.sessions.open({ ...nthSession(1), fence }, go());
  await plantTurn(subject, fence, { n: 1, endedAtMs: 500, saidAtMs: 400 });
  await plantTurn(subject, fence, { n: 2, endedAtMs: 900, saidAtMs: 1_100 });
  await plantTurn(subject, fence, { n: 3, saidAtMs: 600 });
  await plantTurn(subject, fence, { n: 4, endedAtMs: 1_500 });
  const taken = await plantMessage(subject, fence, { n: 1, atMs: 100 });
  const dropped = await plantMessage(subject, fence, { n: 2, atMs: 200 });
  await plantMessage(subject, fence, { n: 3, atMs: 300 });
  await plantMessage(subject, fence, { n: 4, atMs: 1_200 });
  await subject.queue.take({ messages: [taken], turn: nthId("trn", 1), fence }, go());
  await subject.queue.drop({ message: dropped, atMs: 250, reason: "budget", fence }, go());
  assert.deepEqual(await subject.retention.prune({ beforeMs: cutoff, fence }, go()), {
    ok: true,
    value: { events: 2, turns: 1, messages: 2 },
  });
  const events = await subject.transcript.events({ sessionId, limit: 10 }, go());
  assert.deepEqual(
    events.map((event) => [event.seq, event.turnId]),
    [[2, nthId("trn", 2)]],
  );
  const turns = await Promise.all(
    [1, 2, 3, 4].map(async (n) => subject.sessions.turn(nthId("trn", n), go())),
  );
  assert.deepEqual(
    turns.map((turn) => turn?.id),
    [undefined, nthId("trn", 2), nthId("trn", 3), nthId("trn", 4)],
  );
  const waiting = await subject.queue.waiting({ sessionId, limit: 10 }, go());
  assert.deepEqual(
    waiting.map((message) => message.message),
    [nthId("msg", 3), nthId("msg", 4)],
  );
  assert.notEqual(await subject.sessions.get(sessionId, go()), undefined);
}

function said(atMs: number): EventDraft {
  return { role: "owner", kind: "text", content: { atMs }, outside: false, atMs };
}

// A session's next event after a prune is numbered past the last one kept, so its events still
// read in the order they were said.
async function numbersPastKept(subject: ChatRetentionSubject, fence: number): Promise<void> {
  await subject.sessions.open({ ...nthSession(1), fence }, go());
  const events = [said(100), said(200), said(2_000)];
  await subject.transcript.append({ sessionId, events, fence }, go());
  await subject.retention.prune({ beforeMs: cutoff, fence }, go());
  await subject.transcript.append({ sessionId, events: [said(3_000)], fence }, go());
  const read = await subject.transcript.events({ sessionId, limit: 10 }, go());
  assert.deepEqual(
    read.map((event) => [event.seq, event.atMs]),
    [
      [3, 2_000],
      [4, 3_000],
    ],
  );
}

async function refusesStaleFence(subject: ChatRetentionSubject, old: number): Promise<void> {
  await subject.sessions.open({ ...nthSession(1), fence: old }, go());
  await plantTurn(subject, old, { n: 1, endedAtMs: 500, saidAtMs: 400 });
  await subject.fence.raise(go());
  assert.deepEqual(await subject.retention.prune({ beforeMs: cutoff, fence: old }, go()), {
    ok: false,
    error: "fenced",
  });
  assert.equal((await subject.transcript.events({ sessionId, limit: 10 }, go())).length, 1);
}

async function refusesAborted(subject: ChatRetentionSubject, fence: number): Promise<void> {
  await subject.sessions.open({ ...nthSession(1), fence }, go());
  await plantTurn(subject, fence, { n: 1, endedAtMs: 500, saidAtMs: 400 });
  const prune = { beforeMs: cutoff, fence };
  await rejectsAborted(async (options) => subject.retention.prune(prune, options));
  assert.equal((await subject.transcript.events({ sessionId, limit: 10 }, go())).length, 1);
}

/** The contract every `ChatRetention` adapter passes. */
export function chatRetentionContract(harness: ChatRetentionHarness): readonly ContractCheck[] {
  const create = async (): Promise<ChatRetentionSubject> => harness.create();
  return [
    fencedCheck(
      "removes the events, ended turns and settled messages older than the cutoff, and no more",
      create,
      prunesOldChats,
    ),
    fencedCheck(
      "numbers a session's next event past the last one a prune kept",
      create,
      numbersPastKept,
    ),
    fencedCheck("refuses a prune made with a fence raised since", create, refusesStaleFence),
    fencedCheck("refuses a prune on an aborted signal and removes nothing", create, refusesAborted),
  ];
}
