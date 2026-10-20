import { z } from "zod";
import type { AgentTables } from "../databases/agent-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { changedRows } from "../tasks/count-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** What a reset cleared from `engine.sqlite`, in rows. */
export interface EngineStateCleared {
  /** Messages for the agent runtime it had not taken. */
  readonly inbox: number;
  /** The agents' questions to the owner, with their surface copies. */
  readonly questions: number;
  /** Cached token risk reports. */
  readonly riskReports: number;
  /** Agents whose open chat session was let go, so their next message opens a new one. */
  readonly agents: number;
}

/** What a reset cleared from `agent.sqlite`, in rows. */
export interface AgentStateCleared {
  readonly sessions: number;
  readonly turns: number;
  readonly events: number;
  readonly queued: number;
  readonly notes: number;
}

const count = z.int().min(0);

/** Parses what a reset cleared from `engine.sqlite`. */
const engineStateClearedSchema: z.ZodType<EngineStateCleared> = z.strictObject({
  inbox: count,
  questions: count,
  riskReports: count,
  agents: count,
});

/** Parses what a reset cleared from `agent.sqlite`. */
const agentStateClearedSchema: z.ZodType<AgentStateCleared> = z.strictObject({
  sessions: count,
  turns: count,
  events: count,
  queued: count,
  notes: count,
});

/**
 * Clears the chats' traces and the caches from `engine.sqlite` in one transaction: the agent
 * inbox, the agents' questions and their copies, and the token risk cache; each agent's open chat
 * session is let go. Money, safety and access records stay.
 */
export const clearEngineStateTask: StoreTask<null, EngineStateCleared> = defineTask({
  name: "reset.clear_engine",
  access: "write",
  input: z.null(),
  output: engineStateClearedSchema,
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(kysely.deleteFrom("question_messages"));
    const questions = changedRows(execute(kysely.deleteFrom("questions")));
    const inbox = changedRows(execute(kysely.deleteFrom("agent_inbox")));
    const riskReports = changedRows(execute(kysely.deleteFrom("risk_cache")));
    const agents = changedRows(
      execute(
        kysely
          .updateTable("agents")
          .set({ chat_session_id: null })
          .where("chat_session_id", "is not", null),
      ),
    );
    return { inbox, questions, riskReports, agents };
  },
});

// The key whose value lets the transcript's trigger allow a removal; it lives only inside the
// task's transaction. Every event is older than this.
const pruneKey = "prune_before";
const afterEveryEvent = String(Number.MAX_SAFE_INTEGER);
const fenceKey = "writer_fence";

/**
 * Clears every chat and note from `agent.sqlite` in one transaction: sessions, turns, transcript
 * events, queued messages and notes. It raises the writer fence first, so a runtime that started
 * before it can write nothing after it.
 */
export const clearAgentStateTask: StoreTask<null, AgentStateCleared> = defineTask({
  name: "reset.clear_agent",
  access: "write",
  input: z.null(),
  output: agentStateClearedSchema,
  run(database) {
    const { kysely, execute, takeFirst } = createSyncKysely<AgentTables>(database);
    const fence = takeFirst(kysely.selectFrom("meta").select("value").where("key", "=", fenceKey));
    const raised = String(Number(fence?.value ?? "0") + 1);
    execute(
      kysely
        .insertInto("meta")
        .values({ key: fenceKey, value: raised })
        .onConflict((conflict) => conflict.column("key").doUpdateSet({ value: raised })),
    );
    execute(kysely.insertInto("meta").values({ key: pruneKey, value: afterEveryEvent }));
    const events = changedRows(execute(kysely.deleteFrom("transcript_events")));
    const queued = changedRows(execute(kysely.deleteFrom("chat_queue")));
    const turns = changedRows(execute(kysely.deleteFrom("turns")));
    const sessions = changedRows(execute(kysely.deleteFrom("sessions")));
    const notes = changedRows(execute(kysely.deleteFrom("notes")));
    execute(kysely.deleteFrom("meta").where("key", "=", pruneKey));
    return { sessions, turns, events, queued, notes };
  },
});
