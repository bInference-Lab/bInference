// The agent inbox's reads and writes, run inside the caller's transaction: the inbox store's own
// tasks, and the intent writes that store a settle message with the move that ends an intent.
import type { DatabaseSync } from "node:sqlite";
import { type Id, idSchema } from "@binference/core";
import { type IntentRecord, isTerminalState } from "@binference/engine";
import {
  type AgentInboxMessage,
  agentInboxMessageSchema,
  isRuntimeProposal,
  maxUntakenMessages,
  settleIdsOf,
} from "@binference/engine/chat";
import type { Selectable } from "kysely";
import type { AgentInboxTable } from "../databases/agent-inbox-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, readJson } from "../rows/column-values.js";

/** Reads one stored message back into its record. */
export function toAgentInboxMessage(row: Selectable<AgentInboxTable>): AgentInboxMessage {
  return agentInboxMessageSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    sessionId: row.session_id,
    kind: row.kind,
    ...field("turnId", row.turn_id),
    payload: readJson(row.payload),
    createdAtMs: row.created_at,
    ...field("takenAtMs", row.taken_at),
  });
}

/** How many messages the agent holds that the runtime has not taken. */
export function untakenCount(database: DatabaseSync, agent: string): number {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("agent_inbox")
      .select((builder) => builder.fn.countAll<number>().as("count"))
      .where("agent_id", "=", agent)
      .where("taken_at", "is", null),
  );
  return row?.count ?? 0;
}

/**
 * The agent's open session, opening `opens` when none is open. `undefined` for an unknown agent.
 */
export function sessionFor(
  database: DatabaseSync,
  agent: string,
  opens: Id<"ses">,
): Id<"ses"> | undefined {
  const { kysely, takeFirst, execute } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely.selectFrom("agents").select("chat_session_id").where("id", "=", agent),
  );
  if (row === undefined) {
    return undefined;
  }
  if (row.chat_session_id !== null) {
    return idSchema("ses").parse(row.chat_session_id);
  }
  execute(kysely.updateTable("agents").set({ chat_session_id: opens }).where("id", "=", agent));
  return opens;
}

/** Inserts one message and reads it back. */
export function insertMessage(
  database: DatabaseSync,
  message: AgentInboxMessage,
): AgentInboxMessage {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("agent_inbox").values({
      id: message.id,
      agent_id: message.agentId,
      session_id: message.sessionId,
      kind: message.kind,
      turn_id: message.turnId ?? null,
      payload: jsonText(message.payload),
      created_at: message.createdAtMs,
      taken_at: null,
    }),
  );
  return message;
}

// The cause of the intent's first event, which names who proposed it.
function firstCause(database: DatabaseSync, intent: Id<"int">): string | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  return takeFirst(
    kysely
      .selectFrom("intent_events")
      .select("cause")
      .where("intent_id", "=", intent)
      .orderBy("id")
      .limit(1),
  )?.cause;
}

/**
 * Stores the settle message of an intent the write left in `intent.state`, in the write's own
 * transaction: only for a terminal state of an intent the agent runtime proposed, and none while
 * its agent holds 200 untaken messages (runtime spec, section 3.2).
 */
export function settleIntent(
  database: DatabaseSync,
  intent: IntentRecord,
): AgentInboxMessage | undefined {
  if (!isTerminalState(intent.state)) {
    return undefined;
  }
  const cause = firstCause(database, intent.id);
  if (cause === undefined || !isRuntimeProposal(readJson(cause))) {
    return undefined;
  }
  if (untakenCount(database, intent.agentId) >= maxUntakenMessages) {
    return undefined;
  }
  const ids = settleIdsOf(intent.id);
  const sessionId = sessionFor(database, intent.agentId, ids.session);
  if (sessionId === undefined) {
    return undefined;
  }
  return insertMessage(database, {
    id: ids.message,
    agentId: intent.agentId,
    sessionId,
    kind: "inbox/intentSettled",
    turnId: ids.turn,
    payload: { intent: intent.id },
    createdAtMs: intent.changedAtMs,
  });
}
