// A test task that writes a chat queue row's payload as raw JSON text, as a runtime before
// decision 0416 could have left it. Nothing in production uses this file.
import { z } from "zod";
import type { AgentTables } from "../databases/agent-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** A queued message and the raw JSON text to put in its payload. */
export interface QueuedPayloadText {
  readonly message: string;
  readonly text: string;
}

/**
 * Puts raw JSON text in a queued message's payload, such as one holding the escape `\u0000`,
 * which a parse reads as U+0000 and which no store takes since decision 0416. The test agent
 * database's worker serves it.
 */
export const setQueuedPayloadTextTask: StoreTask<QueuedPayloadText, null> = defineTask({
  name: "testing.set_queued_payload_text",
  access: "write",
  input: z.strictObject({ message: z.string(), text: z.string() }),
  output: z.null(),
  run(database, change) {
    const { kysely, execute } = createSyncKysely<AgentTables>(database);
    execute(
      kysely
        .updateTable("chat_queue")
        .set({ payload: change.text })
        .where("message", "=", change.message),
    );
    return null;
  },
});
