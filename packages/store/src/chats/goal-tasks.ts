import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { AgentTables, GoalsTable, ProgressNotesTable } from "../databases/agent-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, field, jsonText, readDecimal, readJson } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import {
  goalClearSchema,
  type GoalDraft,
  goalDraftSchema,
  type GoalRecord,
  goalRecordSchema,
  type GoalWrite,
  goalWriteSchema,
  progressNotePutSchema,
  type ProgressNoteRecord,
  progressNoteRecordSchema,
} from "./goal-record.js";
import { readSession } from "./session-tasks.js";

function toGoal(row: Selectable<GoalsTable>): GoalRecord {
  return goalRecordSchema.parse({
    sessionId: row.session_id,
    agentId: row.agent_id,
    objective: row.objective,
    status: row.status,
    ...field("pauseReason", row.pause_reason),
    ...field("note", row.note),
    ...(row.budget_micros === null ? {} : { budgetMicros: readDecimal(row.budget_micros) }),
    spentMicros: readDecimal(row.spent_micros),
    goalTurns: row.goal_turns,
    strikes: row.strikes,
    startedAtMs: row.started_at,
    updatedAtMs: row.updated_at,
    version: row.version,
  });
}

function toNote(row: Selectable<ProgressNotesTable>): ProgressNoteRecord {
  return progressNoteRecordSchema.parse({
    sessionId: row.session_id,
    agentId: row.agent_id,
    markdown: row.markdown,
    plan: readJson(row.plan),
    updatedAtMs: row.updated_at,
  });
}

function readGoal(database: StoreConnection, session: string): GoalRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("goals").selectAll().where("session_id", "=", session));
  return row === undefined ? undefined : toGoal(row);
}

function readNote(database: StoreConnection, session: string): ProgressNoteRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const select = kysely.selectFrom("progress_notes").selectAll().where("session_id", "=", session);
  const row = takeFirst(select);
  return row === undefined ? undefined : toNote(row);
}

/** Reads a chat's goal. */
export const getGoalTask: StoreTask<Id<"ses">, GoalRecord | undefined> = defineTask({
  name: "chats.get_goal",
  access: "read",
  input: idSchema("ses"),
  output: goalRecordSchema.optional(),
  run: (database, session) => readGoal(database, session),
});

/** The most active goals one read lists. */
const mostActive = 100;

/** Lists the active goals, the oldest set first. */
export const activeGoalsTask: StoreTask<null, readonly GoalRecord[]> = defineTask({
  name: "chats.active_goals",
  access: "read",
  input: z.null(),
  output: z.array(goalRecordSchema),
  run(database) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const select = kysely
      .selectFrom("goals")
      .selectAll()
      .where("status", "=", "active")
      .orderBy("started_at")
      .orderBy("session_id")
      .limit(mostActive);
    return execute(select).rows.map(toGoal);
  },
});

/** Sets a chat's goal, `active` with nothing spent; a chat that has one keeps it. */
export const setGoalTask: StoreTask<
  Fenced<GoalDraft>,
  Result<GoalRecord, FenceRefusal | "exists" | "no_session">
> = defineTask({
  name: "chats.set_goal",
  access: "write",
  input: goalDraftSchema,
  output: resultSchema(goalRecordSchema, ["fenced", "exists", "no_session"]),
  run(database, { fence, ...draft }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readGoal(database, draft.sessionId) !== undefined) {
      return err("exists");
    }
    if (readSession(database, draft.sessionId) === undefined) {
      return err("no_session");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.insertInto("goals").values({
        session_id: draft.sessionId,
        agent_id: draft.agentId,
        objective: draft.objective,
        status: "active",
        pause_reason: null,
        note: null,
        budget_micros: draft.budgetMicros === undefined ? null : decimalText(draft.budgetMicros),
        spent_micros: "0",
        goal_turns: 0,
        strikes: 0,
        started_at: draft.startedAtMs,
        updated_at: draft.startedAtMs,
        version: 0,
      }),
    );
    const set = readGoal(database, draft.sessionId);
    return set === undefined ? err("no_session") : ok(set);
  },
});

/** Writes a chat's goal from the version its writer read. */
export const writeGoalTask: StoreTask<
  Fenced<GoalWrite>,
  Result<GoalRecord, FenceRefusal | "not_found" | "stale">
> = defineTask({
  name: "chats.write_goal",
  access: "write",
  input: goalWriteSchema,
  output: resultSchema(goalRecordSchema, ["fenced", "not_found", "stale"]),
  run(database, { fence, sessionId, version, next }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    const stored = readGoal(database, sessionId);
    if (stored === undefined) {
      return err("not_found");
    }
    if (stored.version !== version) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const change = {
      status: next.status,
      pause_reason: next.pauseReason ?? null,
      note: next.note ?? null,
      spent_micros: decimalText(next.spentMicros),
      goal_turns: next.goalTurns,
      strikes: next.strikes,
      updated_at: Math.max(next.updatedAtMs, stored.startedAtMs),
      version: stored.version + 1,
    };
    execute(kysely.updateTable("goals").set(change).where("session_id", "=", sessionId));
    const written = readGoal(database, sessionId);
    return written === undefined ? err("not_found") : ok(written);
  },
});

/** Removes a chat's goal; answers whether it had one. */
export const clearGoalTask: StoreTask<
  Fenced<{ readonly sessionId: Id<"ses"> }>,
  Result<boolean, FenceRefusal>
> = defineTask({
  name: "chats.clear_goal",
  access: "write",
  input: goalClearSchema,
  output: resultSchema(z.boolean(), ["fenced"]),
  run(database, { fence, sessionId }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    const had = readGoal(database, sessionId) !== undefined;
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(kysely.deleteFrom("goals").where("session_id", "=", sessionId));
    return ok(had);
  },
});

/** Reads a chat's progress note. */
export const getProgressNoteTask: StoreTask<Id<"ses">, ProgressNoteRecord | undefined> = defineTask(
  {
    name: "chats.get_progress_note",
    access: "read",
    input: idSchema("ses"),
    output: progressNoteRecordSchema.optional(),
    run: (database, session) => readNote(database, session),
  },
);

/**
 * Replaces a chat's progress note whole; a note with no markdown and no step removes it. Answers
 * the note kept, none once removed.
 */
export const putProgressNoteTask: StoreTask<
  Fenced<ProgressNoteRecord>,
  Result<ProgressNoteRecord | undefined, FenceRefusal | "no_session">
> = defineTask({
  name: "chats.put_progress_note",
  access: "write",
  input: progressNotePutSchema,
  output: resultSchema(progressNoteRecordSchema.optional(), ["fenced", "no_session"]),
  run(database, { fence, ...note }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readSession(database, note.sessionId) === undefined) {
      return err("no_session");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(kysely.deleteFrom("progress_notes").where("session_id", "=", note.sessionId));
    if (note.markdown === "" && note.plan.length === 0) {
      return ok(undefined);
    }
    execute(
      kysely.insertInto("progress_notes").values({
        session_id: note.sessionId,
        agent_id: note.agentId,
        markdown: note.markdown,
        plan: jsonText(note.plan.map((step) => ({ text: step.text, state: step.state }))),
        updated_at: note.updatedAtMs,
      }),
    );
    return ok(readNote(database, note.sessionId));
  },
});
