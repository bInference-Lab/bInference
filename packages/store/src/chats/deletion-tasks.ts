import { err, type Id, ok, type Result } from "@binference/core";
import type { Compilable } from "kysely";
import type { AgentTables } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { changedRows } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  type ChatDelete,
  chatDeleteSchema,
  type ChatsDeleted,
  chatsDeletedSchema,
} from "./chat-deletion.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";

// The key whose value lets the transcript's trigger allow a removal; it lives only inside this
// task's transaction (decision 0169). Every event is older than its value.
const pruneKey = "prune_before";
const afterEveryEvent = String(Number.MAX_SAFE_INTEGER);

/**
 * Deletes the chosen agents' chats in one transaction (decision 0415): each of their sessions, a
 * helper's own among them, with every transcript event, turn, queued message, goal, progress note
 * and helper. Their notes stay, and so does every other agent's row.
 */
export const deleteChatsTask: StoreTask<
  Fenced<ChatDelete>,
  Result<ChatsDeleted, FenceRefusal>
> = defineTask({
  name: "chats.delete",
  access: "write",
  input: chatDeleteSchema,
  output: resultSchema(chatsDeletedSchema, ["fenced"]),
  run(database, deletion) {
    if (!holdsFence(database, deletion.fence)) {
      return err("fenced");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const agents: readonly Id<"agt">[] = deletion.agents;
    const sessions = kysely.selectFrom("sessions").select("id").where("agent_id", "in", agents);
    const removed = (query: Compilable): number => changedRows(execute(query));
    execute(kysely.insertInto("meta").values({ key: pruneKey, value: afterEveryEvent }));
    const deleted = {
      events: removed(kysely.deleteFrom("transcript_events").where("session_id", "in", sessions)),
      messages: removed(kysely.deleteFrom("chat_queue").where("agent_id", "in", agents)),
      turns: removed(kysely.deleteFrom("turns").where("session_id", "in", sessions)),
      // A helper and a chat's goal and progress note name their sessions, so they go before them.
      helpers: removed(kysely.deleteFrom("helpers").where("agent_id", "in", agents)),
      goals: removed(kysely.deleteFrom("goals").where("agent_id", "in", agents)),
      progressNotes: removed(kysely.deleteFrom("progress_notes").where("agent_id", "in", agents)),
    };
    const gone = removed(kysely.deleteFrom("sessions").where("agent_id", "in", agents));
    execute(kysely.deleteFrom("meta").where("key", "=", pruneKey));
    return ok({ sessions: gone, ...deleted });
  },
});
