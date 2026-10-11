import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { AgentTables, QueueRow } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText, readJson } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";
import {
  type QueueDraft,
  queueDraftSchema,
  type QueueDrop,
  queueDropSchema,
  type QueuedMessage,
  queuedMessageSchema,
  type QueueTake,
  takenBy,
  queueTakeSchema,
  type WaitingQuery,
  waitingQuerySchema,
} from "./queued-message.js";

function toQueued(row: QueueRow): QueuedMessage {
  return queuedMessageSchema.parse({
    message: row.message,
    agentId: row.agent_id,
    sessionId: row.session_id,
    kind: row.kind,
    payload: readJson(row.payload),
    receivedAtMs: row.received_at,
    ...(row.turn_id === null ? {} : { turnId: row.turn_id }),
    ...(row.dropped_at === null
      ? {}
      : { droppedAtMs: row.dropped_at, dropReason: row.drop_reason }),
  });
}

function readQueued(database: DatabaseSync, message: string): QueuedMessage | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("chat_queue").selectAll().where("message", "=", message));
  return row === undefined ? undefined : toQueued(row);
}

function isWaiting(message: QueuedMessage | undefined): message is QueuedMessage {
  return message !== undefined && message.turnId === undefined && message.droppedAtMs === undefined;
}

/** Adds a message to the chat queue once. */
export const addQueuedTask: StoreTask<
  Fenced<QueueDraft>,
  Result<QueuedMessage, FenceRefusal | "exists">
> = defineTask({
  name: "chats.add_queued",
  access: "write",
  input: queueDraftSchema,
  output: resultSchema(queuedMessageSchema, ["fenced", "exists"]),
  run(database, { fence, ...draft }) {
    if (!holdsFence(database, fence)) {
      return err("fenced");
    }
    if (readQueued(database, draft.message) !== undefined) {
      return err("exists");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely.insertInto("chat_queue").values({
        message: draft.message,
        agent_id: draft.agentId,
        session_id: draft.sessionId,
        kind: draft.kind,
        payload: jsonText(draft.payload),
        received_at: draft.receivedAtMs,
        turn_id: null,
        dropped_at: null,
        drop_reason: null,
      }),
    );
    return ok(draft);
  },
});

/** Lists the waiting messages of a session, or of every session, oldest first. */
export const waitingTask: StoreTask<WaitingQuery, readonly QueuedMessage[]> = defineTask({
  name: "chats.waiting",
  access: "read",
  input: waitingQuerySchema,
  output: z.array(queuedMessageSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const all = kysely.selectFrom("chat_queue").selectAll();
    const scoped =
      query.sessionId === undefined ? all : all.where("session_id", "=", query.sessionId);
    const waiting = scoped
      .where("turn_id", "is", null)
      .where("dropped_at", "is", null)
      .orderBy("received_at")
      .orderBy("message")
      .limit(query.limit);
    return execute(waiting).rows.map(toQueued);
  },
});

/** Gives waiting messages to a turn, all or none. */
export const takeQueuedTask: StoreTask<
  Fenced<QueueTake>,
  Result<readonly QueuedMessage[], FenceRefusal | "not_waiting">
> = defineTask({
  name: "chats.take_queued",
  access: "write",
  input: queueTakeSchema,
  output: resultSchema(z.array(queuedMessageSchema), ["fenced", "not_waiting"]),
  run(database, take) {
    if (!holdsFence(database, take.fence)) {
      return err("fenced");
    }
    const waiting = take.messages.map((message) => readQueued(database, message));
    if (!waiting.every(isWaiting) || new Set(take.messages).size !== take.messages.length) {
      return err("not_waiting");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .updateTable("chat_queue")
        .set({ turn_id: take.turn })
        .where("message", "in", take.messages),
    );
    return ok(waiting.map((message) => takenBy(message, take.turn)));
  },
});

/** Drops a waiting message with its reason. */
export const dropQueuedTask: StoreTask<
  Fenced<QueueDrop>,
  Result<QueuedMessage, FenceRefusal | "not_found" | "not_waiting">
> = defineTask({
  name: "chats.drop_queued",
  access: "write",
  input: queueDropSchema,
  output: resultSchema(queuedMessageSchema, ["fenced", "not_found", "not_waiting"]),
  run(database, drop) {
    const stored = readQueued(database, drop.message);
    if (!holdsFence(database, drop.fence)) {
      return err("fenced");
    }
    if (stored === undefined) {
      return err("not_found");
    }
    if (!isWaiting(stored)) {
      return err("not_waiting");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .updateTable("chat_queue")
        .set({ dropped_at: drop.atMs, drop_reason: drop.reason })
        .where("message", "=", drop.message),
    );
    return ok({ ...stored, droppedAtMs: drop.atMs, dropReason: drop.reason });
  },
});
