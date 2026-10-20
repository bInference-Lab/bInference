import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type AgentInboxDraft,
  agentInboxDraftSchema,
  type AgentInboxMessage,
  agentInboxMessageSchema,
  type InboxTake,
  inboxTakeSchema,
  maxUntakenMessages,
  needsRoom,
  type UntakenQuery,
  untakenQuerySchema,
} from "@binference/engine/chat";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { changedRows, rowCountSchema } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  insertMessage,
  sessionFor,
  toAgentInboxMessage,
  untakenCount,
} from "./agent-inbox-writes.js";

/**
 * Stores an owner's message in the agent's open session, opening the draft's when none is open,
 * and moves the open session to the draft's `next`. An id in use fails the primary key.
 */
export const addInboxMessageTask: StoreTask<
  AgentInboxDraft,
  Result<AgentInboxMessage, "busy" | "not_found">
> = defineTask({
  name: "agentInbox.add",
  access: "write",
  input: agentInboxDraftSchema,
  output: resultSchema(agentInboxMessageSchema, ["busy", "not_found"]),
  run(database, draft) {
    const { kysely, takeFirst, execute } = createSyncKysely<EngineTables>(database);
    const agent = takeFirst(
      kysely.selectFrom("agents").select("id").where("id", "=", draft.agentId),
    );
    if (agent === undefined) {
      return err("not_found");
    }
    if (needsRoom(draft.kind) && untakenCount(database, draft.agentId) >= maxUntakenMessages) {
      return err("busy");
    }
    const sessionId = sessionFor(database, draft.agentId, draft.opens) ?? draft.opens;
    const message = insertMessage(database, {
      id: draft.id,
      agentId: draft.agentId,
      sessionId,
      kind: draft.kind,
      ...(draft.turnId === undefined ? {} : { turnId: draft.turnId }),
      payload: draft.payload,
      createdAtMs: draft.atMs,
    });
    if (draft.next !== undefined) {
      execute(
        kysely
          .updateTable("agents")
          .set({ chat_session_id: draft.next })
          .where("id", "=", draft.agentId),
      );
    }
    return ok(message);
  },
});

/** One stored message, taken or not, or none. */
export const getInboxMessageTask: StoreTask<Id<"msg">, AgentInboxMessage | undefined> = defineTask({
  name: "agentInbox.get",
  access: "read",
  input: idSchema("msg"),
  output: agentInboxMessageSchema.optional(),
  run(database, id) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(kysely.selectFrom("agent_inbox").selectAll().where("id", "=", id));
    return row === undefined ? undefined : toAgentInboxMessage(row);
  },
});

/** The agent's open session, or none. */
export const openSessionTask: StoreTask<Id<"agt">, Id<"ses"> | undefined> = defineTask({
  name: "agentInbox.openSession",
  access: "read",
  input: idSchema("agt"),
  output: idSchema("ses").optional(),
  run(database, agent) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("agents").select("chat_session_id").where("id", "=", agent),
    );
    return row?.chat_session_id === null || row === undefined
      ? undefined
      : idSchema("ses").parse(row.chat_session_id);
  },
});

/** Lists untaken messages, the oldest first, then by id. */
export const untakenMessagesTask: StoreTask<UntakenQuery, readonly AgentInboxMessage[]> =
  defineTask({
    name: "agentInbox.untaken",
    access: "read",
    input: untakenQuerySchema,
    output: z.array(agentInboxMessageSchema),
    run(database, query) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const { agentId, after, limit } = query;
      const untaken = kysely.selectFrom("agent_inbox").selectAll().where("taken_at", "is", null);
      const ofAgent = agentId === undefined ? untaken : untaken.where("agent_id", "=", agentId);
      const paged =
        after === undefined
          ? ofAgent
          : ofAgent.where((builder) =>
              builder.or([
                builder("created_at", ">", after.createdAtMs),
                builder.and([
                  builder("created_at", "=", after.createdAtMs),
                  builder("id", ">", after.id),
                ]),
              ]),
            );
      return execute(paged.orderBy("created_at").orderBy("id").limit(limit)).rows.map(
        toAgentInboxMessage,
      );
    },
  });

/** Marks untaken messages taken; one taken before keeps its first time. */
export const takeMessagesTask: StoreTask<InboxTake, number> = defineTask({
  name: "agentInbox.take",
  access: "write",
  input: inboxTakeSchema,
  output: rowCountSchema,
  run(database, take) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return changedRows(
      execute(
        kysely
          .updateTable("agent_inbox")
          .set({ taken_at: take.atMs })
          .where("id", "in", take.ids)
          .where("taken_at", "is", null),
      ),
    );
  },
});
