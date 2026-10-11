import type { DatabaseSync } from "node:sqlite";
import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { Selectable, Updateable } from "kysely";
import { z } from "zod";
import type { AgentTables, TurnsTable } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import { readSession } from "./session-tasks.js";
import {
  type TurnDraft,
  turnDraftSchema,
  type TurnEnd,
  turnEndSchema,
  type TurnRecord,
  turnRecordSchema,
  type TurnRef,
  turnRefSchema,
} from "./turn-record.js";

type TurnChange = Result<TurnRecord, FenceRefusal | "not_found" | "ended">;

const turnChangeSchema = resultSchema(turnRecordSchema, ["fenced", "not_found", "ended"]);

function toTurn(row: Selectable<TurnsTable>): TurnRecord {
  return turnRecordSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    startedAtMs: row.started_at,
    ...field("endedAtMs", row.ended_at),
    ...field("outcome", row.outcome),
    committed: row.committed === 1,
    outsideContent: row.outside_content === 1,
    heldBack: row.held_back,
    ...field("model", row.model),
  });
}

/** One turn row, read inside the caller's transaction. */
export function readTurn(database: DatabaseSync, id: string): TurnRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("turns").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toTurn(row);
}

// Changes a turn that has not ended, under the current fence, and answers it as it now stands.
function changeTurn(
  database: DatabaseSync,
  ref: Fenced<TurnRef>,
  change: Updateable<TurnsTable>,
): TurnChange {
  if (!holdsFence(database, ref.fence)) {
    return err("fenced");
  }
  const stored = readTurn(database, ref.turn);
  if (stored === undefined) {
    return err("not_found");
  }
  if (stored.endedAtMs !== undefined) {
    return err("ended");
  }
  const { kysely, execute } = createSyncKysely<AgentTables>(database);
  execute(kysely.updateTable("turns").set(change).where("id", "=", ref.turn));
  const changed = readTurn(database, ref.turn);
  return changed === undefined ? err("not_found") : ok(changed);
}

/** Starts a turn once, in a session the database holds. */
export const startTurnTask: StoreTask<
  Fenced<TurnDraft>,
  Result<TurnRecord, FenceRefusal | "exists" | "no_session">
> = defineTask({
  name: "chats.start_turn",
  access: "write",
  input: turnDraftSchema,
  output: resultSchema(turnRecordSchema, ["fenced", "exists", "no_session"]),
  run(database, { fence, ...draft }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readSession(database, draft.sessionId) === undefined) {
      return err("no_session");
    }
    if (readTurn(database, draft.id) !== undefined) {
      return err("exists");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.insertInto("turns").values({
        id: draft.id,
        session_id: draft.sessionId,
        started_at: draft.startedAtMs,
        ended_at: null,
        outcome: null,
        outside_content: draft.outsideContent ? 1 : 0,
        model: draft.model ?? null,
      }),
    );
    return ok({ ...draft, committed: false, heldBack: 0 });
  },
});

/** Sets a turn's committed mark. */
export const commitTurnTask: StoreTask<Fenced<TurnRef>, TurnChange> = defineTask({
  name: "chats.commit_turn",
  access: "write",
  input: turnRefSchema,
  output: turnChangeSchema,
  run: (database, ref) => changeTurn(database, ref, { committed: 1 }),
});

/** Sets a turn's outside-content mark. */
export const markOutsideTask: StoreTask<Fenced<TurnRef>, TurnChange> = defineTask({
  name: "chats.mark_outside",
  access: "write",
  input: turnRefSchema,
  output: turnChangeSchema,
  run: (database, ref) => changeTurn(database, ref, { outside_content: 1 }),
});

/** Ends a turn once. */
export const endTurnTask: StoreTask<Fenced<TurnEnd>, TurnChange> = defineTask({
  name: "chats.end_turn",
  access: "write",
  input: turnEndSchema,
  output: turnChangeSchema,
  run: (database, end) =>
    changeTurn(database, end, {
      ended_at: end.atMs,
      outcome: end.outcome,
      held_back: end.heldBack,
    }),
});

/** Reads one turn. */
export const getTurnTask: StoreTask<Id<"trn">, TurnRecord | undefined> = defineTask({
  name: "chats.get_turn",
  access: "read",
  input: idSchema("trn"),
  output: turnRecordSchema.optional(),
  run: (database, id) => readTurn(database, id),
});

/** Lists the turns with no end, oldest first. */
export const unfinishedTurnsTask: StoreTask<null, readonly TurnRecord[]> = defineTask({
  name: "chats.unfinished_turns",
  access: "read",
  input: z.null(),
  output: z.array(turnRecordSchema),
  run(database) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const open = kysely
      .selectFrom("turns")
      .selectAll()
      .where("ended_at", "is", null)
      .orderBy("started_at")
      .orderBy("id");
    return execute(open).rows.map(toTurn);
  },
});
