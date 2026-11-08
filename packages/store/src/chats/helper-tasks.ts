import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import type { Updateable } from "kysely";
import { z } from "zod";
import type { AgentTables, HelpersTable } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import {
  type HelperDraft,
  helperDraftSchema,
  type HelperMove,
  helperMoveSchema,
  type HelperQuery,
  helperQuerySchema,
  type HelperRecord,
  helperRecordSchema,
} from "./helper-record.js";
import { readHelper, toHelper } from "./helper-rows.js";
import { insertSession, readSession } from "./session-tasks.js";

// A helper's session names where it began, so a reader of sessions can tell it from a chat.
const helperSurface = "helper";

/** Opens a helper's session and keeps the helper as running, in one write. */
export const startHelperTask: StoreTask<
  Fenced<HelperDraft>,
  Result<HelperRecord, FenceRefusal | "exists" | "no_session">
> = defineTask({
  name: "chats.start_helper",
  access: "write",
  input: helperDraftSchema,
  output: resultSchema(helperRecordSchema, ["fenced", "exists", "no_session"]),
  run(database, { fence, ...draft }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readSession(database, draft.parentSessionId) === undefined) {
      return err("no_session");
    }
    if (readSession(database, draft.id) !== undefined) {
      return err("exists");
    }
    insertSession(database, {
      id: draft.id,
      agentId: draft.agentId,
      surface: helperSurface,
      conversation: `${helperSurface}:${draft.parentSessionId}`,
      startedAtMs: draft.startedAtMs,
    });
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.insertInto("helpers").values({
        id: draft.id,
        agent_id: draft.agentId,
        parent_session_id: draft.parentSessionId,
        label: draft.label,
        model: draft.model ?? null,
        state: "running",
        started_at: draft.startedAtMs,
        ended_at: null,
        timeout_ms: draft.timeoutMs,
        runs: 1,
      }),
    );
    return ok({ ...draft, state: "running", runs: 1, outside: false });
  },
});

/** Reads one helper. */
export const getHelperTask: StoreTask<Id<"ses">, HelperRecord | undefined> = defineTask({
  name: "chats.get_helper",
  access: "read",
  input: idSchema("ses"),
  output: helperRecordSchema.optional(),
  run: (database, id) => readHelper(database, id),
});

/** Lists the helpers a query names, the newest run's start first. */
export const listHelpersTask: StoreTask<HelperQuery, readonly HelperRecord[]> = defineTask({
  name: "chats.list_helpers",
  access: "read",
  input: helperQuerySchema,
  output: z.array(helperRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    let select = kysely.selectFrom("helpers").selectAll();
    if (query.agentId !== undefined) {
      select = select.where("agent_id", "=", query.agentId);
    }
    if (query.state !== undefined) {
      select = select.where("state", "=", query.state);
    }
    const ordered = select.orderBy("started_at", "desc").orderBy("id", "desc").limit(query.limit);
    return execute(ordered).rows.map(toHelper);
  },
});

// What a move writes: a new run, or an end that keeps the outside mark once set.
function changeOf(stored: HelperRecord, move: HelperMove): Updateable<HelpersTable> {
  if (move.to === "running") {
    return {
      state: "running",
      started_at: move.atMs,
      ended_at: null,
      timeout_ms: move.timeoutMs ?? stored.timeoutMs,
      runs: stored.runs + 1,
    };
  }
  const outside = stored.outside || move.outside === true;
  return { state: move.to, ended_at: move.atMs, outside: outside ? 1 : 0 };
}

/** Moves a helper from the state its mover read. */
export const moveHelperTask: StoreTask<
  Fenced<HelperMove>,
  Result<HelperRecord, FenceRefusal | "not_found" | "stale">
> = defineTask({
  name: "chats.move_helper",
  access: "write",
  input: helperMoveSchema,
  output: resultSchema(helperRecordSchema, ["fenced", "not_found", "stale"]),
  run(database, { fence, ...move }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    const stored = readHelper(database, move.helper);
    if (stored === undefined) {
      return err("not_found");
    }
    if (stored.state !== move.from) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.updateTable("helpers").set(changeOf(stored, move)).where("id", "=", move.helper),
    );
    const moved = readHelper(database, move.helper);
    return moved === undefined ? err("not_found") : ok(moved);
  },
});
