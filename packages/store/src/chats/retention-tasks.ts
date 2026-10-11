import { err, ok, type Result } from "@binference/core";
import type { AgentTables } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { changedRows } from "../tasks/count-schema.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  type ChatPrune,
  chatPruneSchema,
  type ChatPruned,
  chatPrunedSchema,
} from "./chat-prune.js";
import { holdsFence } from "./fence-tasks.js";
import type { Fenced, FenceRefusal } from "./fenced.js";

// The key whose value lets the transcript's trigger allow the removal of older events; it lives
// only inside this task's transaction.
const pruneKey = "prune_before";

/** Prunes the chats before a cutoff, in one transaction. */
export const pruneChatsTask: StoreTask<
  Fenced<ChatPrune>,
  Result<ChatPruned, FenceRefusal>
> = defineTask({
  name: "chats.prune",
  access: "write",
  input: chatPruneSchema,
  output: resultSchema(chatPrunedSchema, ["fenced"]),
  run(database, prune) {
    if (!holdsFence(database, prune.fence)) {
      return err("fenced");
    }
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    const { beforeMs } = prune;
    execute(kysely.insertInto("meta").values({ key: pruneKey, value: String(beforeMs) }));
    const events = changedRows(
      execute(kysely.deleteFrom("transcript_events").where("at", "<", beforeMs)),
    );
    const turns = changedRows(
      execute(
        kysely
          .deleteFrom("turns")
          .where("ended_at", "<", beforeMs)
          .where((row) =>
            row.not(
              row.exists(
                row
                  .selectFrom("transcript_events")
                  .select("transcript_events.id")
                  .whereRef("transcript_events.turn_id", "=", "turns.id"),
              ),
            ),
          ),
      ),
    );
    const messages = changedRows(
      execute(
        kysely
          .deleteFrom("chat_queue")
          .where("received_at", "<", beforeMs)
          .where((row) =>
            row.or([row("turn_id", "is not", null), row("dropped_at", "is not", null)]),
          ),
      ),
    );
    execute(kysely.deleteFrom("meta").where("key", "=", pruneKey));
    return ok({ events, turns, messages });
  },
});
