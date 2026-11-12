import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { EventDraft } from "../chats/transcript-event.js";
import type {
  ChatQueueStore,
  ChatRetention,
  GoalStore,
  HelperStore,
  NoteStore,
  SessionStore,
  TranscriptStore,
  WriterFence,
} from "../ports.js";
import { fencedCheck, go, nthId, nthSession, okValue } from "./agent-fixtures.js";
import { plantAcrossCutoff, plantCutoff } from "./agent-tables-plant.js";

// The rules the agent database keeps below its stores, which an in-memory fake has no part in:
// the transcript's triggers (decision 0169) and what retention removes from every table (database
// spec, sections 3, 4 and 6.3).

/** A row of an agent table as a database reads it back: each column's text, number or null. */
export type AgentRow = Readonly<Record<string, string | number | null>>;

/** Every row of every agent table, by table, each table in the order of its key. */
export type AgentRows = Readonly<Record<string, readonly AgentRow[]>>;

/** A fresh agent database's stores, with the reads and writes no store makes. */
export interface AgentTablesSubject {
  readonly sessions: SessionStore;
  readonly transcript: TranscriptStore;
  readonly retention: ChatRetention;
  readonly queue: ChatQueueStore;
  readonly helpers: HelperStore;
  readonly goals: GoalStore;
  readonly notes: NoteStore;
  readonly fence: WriterFence;
  /** Every row of every table. */
  rows(): Promise<AgentRows>;
  /** Changes an event's content straight in its row. */
  changeEvent(id: number): Promise<void>;
  /** Removes a session's events straight, outside retention. */
  removeEvents(session: Id<"ses">): Promise<void>;
}

/** Makes a fresh subject for each check. */
export interface AgentTablesHarness {
  create(): Promise<AgentTablesSubject>;
}

function saidAt(atMs: number): EventDraft {
  return { role: "owner", kind: "text", content: { text: "hi" }, outside: false, atMs };
}

// Opens session `n` and appends one event said at each time, and answers their numbers.
async function sayAt(
  subject: AgentTablesSubject,
  fence: number,
  plan: { readonly session: number; readonly atMs: readonly number[] },
): Promise<readonly number[]> {
  const sessionId = nthId("ses", plan.session);
  await subject.sessions.open({ ...nthSession(plan.session), fence }, go());
  const events = plan.atMs.map((atMs) => saidAt(atMs));
  const written = okValue(await subject.transcript.append({ sessionId, events, fence }, go()));
  return written.map((event) => event.id);
}

// The transcript's trigger refused the write, on either database.
const appendOnly = { code: "store.constraint", message: /append-only/ };

async function refusesChange(subject: AgentTablesSubject, fence: number): Promise<void> {
  const [first] = await sayAt(subject, fence, { session: 1, atMs: [1, 2] });
  const before = await subject.rows();
  await assert.rejects(subject.changeEvent(first ?? 0), appendOnly);
  assert.deepEqual(await subject.rows(), before);
}

async function refusesRemoval(subject: AgentTablesSubject, fence: number): Promise<void> {
  await sayAt(subject, fence, { session: 1, atMs: [1, 2] });
  const before = await subject.rows();
  await assert.rejects(subject.removeEvents(nthId("ses", 1)), appendOnly);
  assert.deepEqual(await subject.rows(), before);
}

// Retention's removal goes through inside its own transaction, which leaves `meta` as it found
// it: an old event said after the run is refused a removal again.
async function letsRetentionRemove(subject: AgentTablesSubject, fence: number): Promise<void> {
  await sayAt(subject, fence, { session: 1, atMs: [100, 2_000] });
  const before = await subject.rows();
  const pruned = okValue(await subject.retention.prune({ beforeMs: 1_000, fence }, go()));
  assert.deepEqual(pruned, { events: 1, turns: 0, messages: 0 });
  const after = await subject.rows();
  assert.deepEqual(after["meta"], before["meta"]);
  assert.deepEqual(
    after["transcript_events"]?.map((event) => event["at"]),
    [2_000],
  );
  await sayAt(subject, fence, { session: 2, atMs: [50] });
  await assert.rejects(subject.removeEvents(nthId("ses", 2)), appendOnly);
}

function isBefore(value: AgentRow[string] | undefined): boolean {
  return typeof value === "number" && value < plantCutoff;
}

// A message received before the cutoff that a turn took or that was dropped.
function isSettledBefore(message: AgentRow): boolean {
  return (
    isBefore(message["received_at"]) &&
    (message["turn_id"] !== null || message["dropped_at"] !== null)
  );
}

// The rows retention leaves (decision 0169): the events said from the cutoff on, every turn but
// those that ended before it and hold no event left, every message but those received before it
// that a turn took or that were dropped, and every other table as it was.
function keptByRetention(rows: AgentRows): AgentRows {
  const events = (rows["transcript_events"] ?? []).filter((event) => !isBefore(event["at"]));
  const holdEvents = new Set(events.map((event) => event["turn_id"]));
  const isGoneTurn = (turn: AgentRow): boolean =>
    isBefore(turn["ended_at"]) && !holdEvents.has(turn["id"] ?? null);
  return {
    ...rows,
    transcript_events: events,
    turns: (rows["turns"] ?? []).filter((turn) => !isGoneTurn(turn)),
    chat_queue: (rows["chat_queue"] ?? []).filter((message) => !isSettledBefore(message)),
  };
}

async function prunesOnlyOldChats(subject: AgentTablesSubject, fence: number): Promise<void> {
  await plantAcrossCutoff(subject, fence);
  const before = await subject.rows();
  const empty = Object.keys(before).filter((table) => before[table]?.length === 0);
  assert.deepEqual(empty, [], "The case leaves a table empty.");
  const pruned = okValue(await subject.retention.prune({ beforeMs: plantCutoff, fence }, go()));
  const kept = keptByRetention(before);
  assert.deepEqual(await subject.rows(), kept);
  const gone = (table: string): number => (before[table]?.length ?? 0) - (kept[table]?.length ?? 0);
  assert.deepEqual(pruned, {
    events: gone("transcript_events"),
    turns: gone("turns"),
    messages: gone("chat_queue"),
  });
  assert.deepEqual(pruned, { events: 4, turns: 2, messages: 2 });
}

/** The agent database's own rules, which every database adapter keeps. */
export function agentTablesContract(harness: AgentTablesHarness): readonly ContractCheck[] {
  const create = async (): Promise<AgentTablesSubject> => harness.create();
  return [
    fencedCheck("refuses a change of a transcript event", create, refusesChange),
    fencedCheck("refuses a removal of transcript events outside retention", create, refusesRemoval),
    fencedCheck(
      "lets retention remove the events before its cutoff and leaves no cutoff behind",
      create,
      letsRetentionRemove,
    ),
    fencedCheck(
      "prunes the old events, ended turns and settled messages, and leaves every other row",
      create,
      prunesOnlyOldChats,
    ),
  ];
}
