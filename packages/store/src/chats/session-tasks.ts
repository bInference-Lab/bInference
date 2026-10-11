import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { AgentTables, SessionRow } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import {
  type SessionClose,
  sessionCloseSchema,
  type SessionDraft,
  sessionDraftSchema,
  type SessionRecord,
  sessionRecordSchema,
} from "./session-record.js";

function toSession(row: SessionRow): SessionRecord {
  return sessionRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    surface: row.surface,
    conversation: row.conversation,
    startedAtMs: row.started_at,
    ...(row.cleared_at === null ? {} : { clearedAtMs: row.cleared_at }),
    ...(row.summary === null ? {} : { summary: row.summary }),
    version: row.version,
  });
}

/** One session row, read inside the caller's transaction. */
export function readSession(database: DatabaseSync, id: string): SessionRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("sessions").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toSession(row);
}

/** Opens a session once. */
export const openSessionTask: StoreTask<
  Fenced<SessionDraft>,
  Result<SessionRecord, FenceRefusal | "exists">
> = defineTask({
  name: "chats.open_session",
  access: "write",
  input: sessionDraftSchema,
  output: resultSchema(sessionRecordSchema, ["fenced", "exists"]),
  run(database, { fence, ...draft }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readSession(database, draft.id) !== undefined) {
      return err("exists");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.insertInto("sessions").values({
        id: draft.id,
        agent_id: draft.agentId,
        surface: draft.surface,
        conversation: draft.conversation,
        started_at: draft.startedAtMs,
        cleared_at: null,
        summary: null,
      }),
    );
    return ok({ ...draft, version: 0 });
  },
});

/** Reads one session. */
export const getSessionTask: StoreTask<Id<"ses">, SessionRecord | undefined> = defineTask({
  name: "chats.get_session",
  access: "read",
  input: idSchema("ses"),
  output: sessionRecordSchema.optional(),
  run: (database, id) => readSession(database, id),
});

/** Closes a session once, at the version its closer read. */
export const closeSessionTask: StoreTask<
  Fenced<SessionClose>,
  Result<SessionRecord, FenceRefusal | "not_found" | "stale" | "closed">
> = defineTask({
  name: "chats.close_session",
  access: "write",
  input: sessionCloseSchema,
  output: resultSchema(sessionRecordSchema, ["fenced", "not_found", "stale", "closed"]),
  run(database, close) {
    const stored = readSession(database, close.session);
    if (!holdsFence(database, close.fence)) {
      return err("fenced");
    }
    if (stored === undefined) {
      return err("not_found");
    }
    if (stored.clearedAtMs !== undefined) {
      return err("closed");
    }
    if (stored.version !== close.version) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .updateTable("sessions")
        .set({ cleared_at: close.atMs, version: close.version + 1 })
        .where("id", "=", close.session)
        .where("version", "=", close.version),
    );
    return ok({ ...stored, clearedAtMs: close.atMs, version: close.version + 1 });
  },
});
