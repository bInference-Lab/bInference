import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { AgentTables, TranscriptEventsTable } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { commitRefusalOf } from "./commit-refusal.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import { readSession } from "./session-tasks.js";
import {
  type CommittingAppend,
  committingAppendSchema,
  type EventAppend,
  eventAppendSchema,
  type EventQuery,
  eventQuerySchema,
  type TranscriptEvent,
  transcriptEventSchema,
} from "./transcript-event.js";
import { readTurn } from "./turn-tasks.js";

type Appended = Result<readonly TranscriptEvent[], FenceRefusal | "no_session" | "no_turn">;

type Committed = Result<
  readonly TranscriptEvent[],
  FenceRefusal | "no_session" | "no_turn" | "ended"
>;

function toEvent(row: Selectable<TranscriptEventsTable>): TranscriptEvent {
  return transcriptEventSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    ...field("turnId", row.turn_id),
    seq: row.seq,
    role: row.role,
    kind: row.kind,
    content: readJson(row.content),
    outside: row.outside === 1,
    atMs: row.at,
  });
}

function lastSeq(database: DatabaseSync, sessionId: string): number {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("transcript_events")
      .select((select) => select.fn.max("seq").as("last"))
      .where("session_id", "=", sessionId),
  );
  return row?.last ?? 0;
}

// Why the append may not be written, read before anything is: the fence, the session, and that
// every turn it names is one of the session's.
function refusalOf(database: DatabaseSync, append: Fenced<EventAppend>) {
  if (!holdsFence(database, append.fence)) {
    return "fenced";
  }
  if (readSession(database, append.sessionId) === undefined) {
    return "no_session";
  }
  const isOwn = (turnId: string | undefined): boolean =>
    turnId === undefined || readTurn(database, turnId)?.sessionId === append.sessionId;
  return append.events.every((event) => isOwn(event.turnId)) ? undefined : "no_turn";
}

// Writes the events after the session's last, numbered in order, and answers them as stored.
function insertEvents(database: DatabaseSync, append: EventAppend): readonly TranscriptEvent[] {
  const first = lastSeq(database, append.sessionId) + 1;
  const { kysely, execute } = createSyncKysely<AgentTables>(database);
  const rows = execute(
    kysely
      .insertInto("transcript_events")
      .values(
        append.events.map((event, index) => ({
          session_id: append.sessionId,
          turn_id: event.turnId ?? null,
          seq: first + index,
          role: event.role,
          kind: event.kind,
          content: jsonText(event.content),
          at: event.atMs,
          outside: event.outside ? 1 : 0,
        })),
      )
      .returningAll(),
  ).rows;
  return rows.map(toEvent);
}

/** Appends events to one session, numbered after its last. */
export const appendEventsTask: StoreTask<Fenced<EventAppend>, Appended> = defineTask({
  name: "chats.append_events",
  access: "write",
  input: eventAppendSchema,
  output: resultSchema(z.array(transcriptEventSchema), ["fenced", "no_session", "no_turn"]),
  run(database, append) {
    const refusal = refusalOf(database, append);
    return refusal === undefined ? ok(insertEvents(database, append)) : err(refusal);
  },
});

/** Appends a turn's events and sets its committed mark, in one transaction. */
export const appendCommittingTask: StoreTask<Fenced<CommittingAppend>, Committed> = defineTask({
  name: "chats.append_committing",
  access: "write",
  input: committingAppendSchema,
  output: resultSchema(z.array(transcriptEventSchema), [
    "fenced",
    "no_session",
    "no_turn",
    "ended",
  ]),
  run(database, append) {
    const refusal =
      refusalOf(database, append) ?? commitRefusalOf(readTurn(database, append.turn), append);
    if (refusal !== undefined) {
      return err(refusal);
    }
    const events = insertEvents(database, append);
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(kysely.updateTable("turns").set({ committed: 1 }).where("id", "=", append.turn));
    return ok(events);
  },
});

/** Reads a session's events after a place, in order. */
export const listEventsTask: StoreTask<EventQuery, readonly TranscriptEvent[]> = defineTask({
  name: "chats.list_events",
  access: "read",
  input: eventQuerySchema,
  output: z.array(transcriptEventSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const events = kysely
      .selectFrom("transcript_events")
      .selectAll()
      .where("session_id", "=", query.sessionId)
      .where("seq", ">", query.afterSeq ?? 0)
      .orderBy("seq")
      .limit(query.limit);
    return execute(events).rows.map(toEvent);
  },
});
