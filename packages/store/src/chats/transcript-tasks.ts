import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { AgentTables, TranscriptEventsTable } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import { readSession } from "./session-tasks.js";
import {
  type EventAppend,
  eventAppendSchema,
  type EventQuery,
  eventQuerySchema,
  type TranscriptEvent,
  transcriptEventSchema,
} from "./transcript-event.js";
import { readTurn } from "./turn-tasks.js";

type Appended = Result<readonly TranscriptEvent[], FenceRefusal | "no_session" | "no_turn">;

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

/** Appends events to one session, numbered after its last. */
export const appendEventsTask: StoreTask<Fenced<EventAppend>, Appended> = defineTask({
  name: "chats.append_events",
  access: "write",
  input: eventAppendSchema,
  output: resultSchema(z.array(transcriptEventSchema), ["fenced", "no_session", "no_turn"]),
  run(database, append) {
    const refusal = refusalOf(database, append);
    if (refusal !== undefined) {
      return err(refusal);
    }
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
    return ok(rows.map(toEvent));
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
