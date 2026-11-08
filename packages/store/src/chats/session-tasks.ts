import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { AgentTables, SessionRow } from "../databases/agent-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
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
  type SessionModel,
  sessionModelSchema,
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
    ...(row.model === null ? {} : { model: row.model }),
    version: row.version,
  });
}

/** One session row, read inside the caller's transaction. */
export function readSession(database: StoreConnection, id: string): SessionRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("sessions").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toSession(row);
}

/** Writes a new session row, inside the caller's transaction, which checked it is new. */
export function insertSession(database: StoreConnection, draft: SessionDraft): void {
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
    insertSession(database, draft);
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

/**
 * Sets or clears an open session's own model (decision 0404). It leaves the session's version as
 * it is: a close at the version its closer read still applies.
 */
export const setSessionModelTask: StoreTask<
  Fenced<SessionModel>,
  Result<SessionRecord, FenceRefusal | "not_found" | "closed">
> = defineTask({
  name: "chats.set_session_model",
  access: "write",
  input: sessionModelSchema,
  output: resultSchema(sessionRecordSchema, ["fenced", "not_found", "closed"]),
  run(database, change) {
    const stored = readSession(database, change.session);
    if (!holdsFence(database, change.fence)) {
      return err("fenced");
    }
    if (stored === undefined) {
      return err("not_found");
    }
    if (stored.clearedAtMs !== undefined) {
      return err("closed");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .updateTable("sessions")
        .set({ model: change.model ?? null })
        .where("id", "=", change.session),
    );
    const changed = readSession(database, change.session);
    return changed === undefined ? err("not_found") : ok(changed);
  },
});

/** How many turns a session holds, ended or not. */
export const countTurnsTask: StoreTask<Id<"ses">, number> = defineTask({
  name: "chats.count_turns",
  access: "read",
  input: idSchema("ses"),
  output: z.int().nonnegative(),
  run(database, session) {
    const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("turns")
        .select((builder) => builder.fn.countAll<number>().as("count"))
        .where("session_id", "=", session),
    );
    return row?.count ?? 0;
  },
});
