import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { holdsFence } from "../chats/fence-tasks.js";
import type { Fenced, FenceRefusal } from "../chats/fenced.js";
import type { AgentTables, NoteRow } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  type NoteDelete,
  noteDeleteSchema,
  type NoteDraft,
  noteDraftSchema,
  type NoteList,
  noteListSchema,
  type NoteRecord,
  noteRecordSchema,
  type NoteSearch,
  noteSearchSchema,
} from "./note-record.js";

// The shortest query the trigram index matches; a shorter one is looked for as a substring.
const shortestQuery = 3;

function toNote(row: NoteRow): NoteRecord {
  return noteRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    text: row.text,
    origin: row.origin,
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    ...field("deletedAtMs", row.deleted_at),
  });
}

function readNote(database: DatabaseSync, id: number): NoteRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("notes").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toNote(row);
}

// The query as one FTS5 phrase: its double quotes doubled, so no character of it is an operator.
function phraseOf(query: string): string {
  return `"${query.replaceAll('"', '""')}"`;
}

/** Writes a note. */
export const writeNoteTask: StoreTask<
  Fenced<NoteDraft>,
  Result<NoteRecord, FenceRefusal>
> = defineTask({
  name: "notes.write",
  access: "write",
  input: noteDraftSchema,
  output: resultSchema(noteRecordSchema, ["fenced"]),
  run(database, draft) {
    if (!holdsFence(database, draft.fence)) {
      return err("fenced");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const inserted = execute(
      kysely.insertInto("notes").values({
        agent_id: draft.agentId,
        text: draft.text,
        origin: draft.origin,
        created_at: draft.atMs,
        changed_at: draft.atMs,
        deleted_at: null,
      }),
    );
    return ok({
      id: Number(inserted.insertId),
      agentId: draft.agentId,
      text: draft.text,
      origin: draft.origin,
      createdAtMs: draft.atMs,
      changedAtMs: draft.atMs,
    });
  },
});

/** Removes a note from lists and searches. */
export const deleteNoteTask: StoreTask<
  Fenced<NoteDelete>,
  Result<NoteRecord, FenceRefusal | "not_found">
> = defineTask({
  name: "notes.delete",
  access: "write",
  input: noteDeleteSchema,
  output: resultSchema(noteRecordSchema, ["fenced", "not_found"]),
  run(database, removal) {
    const stored = readNote(database, removal.note);
    if (!holdsFence(database, removal.fence)) {
      return err("fenced");
    }
    if (stored === undefined || stored.deletedAtMs !== undefined) {
      return err("not_found");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.updateTable("notes").set({ deleted_at: removal.atMs }).where("id", "=", removal.note),
    );
    return ok({ ...stored, deletedAtMs: removal.atMs });
  },
});

/** Lists an agent's notes that are not removed, oldest first. */
export const listNotesTask: StoreTask<NoteList, readonly NoteRecord[]> = defineTask({
  name: "notes.list",
  access: "read",
  input: noteListSchema,
  output: z.array(noteRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const notes = kysely
      .selectFrom("notes")
      .selectAll()
      .where("agent_id", "=", query.agentId)
      .where("deleted_at", "is", null)
      .where("id", ">", query.afterId ?? 0)
      .orderBy("id")
      .limit(query.limit);
    return execute(notes).rows.map(toNote);
  },
});

// A query under three characters, which the trigram index cannot match: the notes whose text holds
// it, in any ASCII letter case, oldest first. `instr` reads no wildcard, so `%` and `_` match
// themselves.
function searchShort(database: DatabaseSync, query: NoteSearch): readonly NoteRecord[] {
  const { kysely, execute } = createSyncKysely<AgentTables>(database);
  const found = kysely
    .selectFrom("notes")
    .selectAll()
    .where("agent_id", "=", query.agentId)
    .where("deleted_at", "is", null)
    .where(
      (eb) =>
        eb.fn<number>("instr", [eb.fn("lower", ["text"]), eb.fn("lower", [eb.val(query.query)])]),
      ">",
      0,
    )
    .orderBy("id")
    .limit(query.limit);
  return execute(found).rows.map(toNote);
}

/**
 * Searches an agent's notes through the trigram index, the best match first; a query under three
 * characters is looked for as a substring instead.
 */
export const searchNotesTask: StoreTask<NoteSearch, readonly NoteRecord[]> = defineTask({
  name: "notes.search",
  access: "read",
  input: noteSearchSchema,
  output: z.array(noteRecordSchema),
  run(database, query) {
    if ((query.query.match(/./gsu)?.length ?? 0) < shortestQuery) {
      return searchShort(database, query);
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const found = kysely
      .selectFrom("notes_fts")
      .innerJoin("notes", "notes.id", "notes_fts.rowid")
      .selectAll("notes")
      .where("notes_fts.notes_fts", "match", phraseOf(query.query))
      .where("notes.agent_id", "=", query.agentId)
      .where("notes.deleted_at", "is", null)
      .orderBy("notes_fts.rank")
      .orderBy("notes.id")
      .limit(query.limit);
    return execute(found).rows.map(toNote);
  },
});
