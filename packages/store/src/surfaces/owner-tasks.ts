import { idSchema } from "@binference/core";
import { type OwnerBinding, ownerBindingSchema } from "@binference/engine/surfaces";
import type { Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { changedRows } from "../tasks/count-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// The table holds one row, `id = 1`, once the owner paired.
const ownerRow = 1;

function toBinding(row: Selectable<EngineTables["telegram_owner"]>): OwnerBinding {
  return ownerBindingSchema.parse({
    userId: row.user_id,
    pairedAtMs: row.paired_at,
    ...field("agentId", row.agent_id),
  });
}

/** The owner the start code paired, or null before any pairing. */
export const getOwnerTask: StoreTask<null, OwnerBinding | null> = defineTask({
  name: "telegram.get_owner",
  access: "read",
  input: z.null(),
  output: ownerBindingSchema.nullable(),
  run(database) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("telegram_owner").selectAll().where("id", "=", ownerRow),
    );
    return row === undefined ? null : toBinding(row);
  },
});

/**
 * Binds the owner in place of any earlier one, in one transaction, and answers the owner it
 * replaced, or null for the first pairing.
 */
export const bindOwnerTask: StoreTask<OwnerBinding, OwnerBinding | null> = defineTask({
  name: "telegram.bind_owner",
  access: "write",
  input: ownerBindingSchema,
  output: ownerBindingSchema.nullable(),
  run(database, binding) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const replaced = takeFirst(
      kysely.selectFrom("telegram_owner").selectAll().where("id", "=", ownerRow),
    );
    const row = { user_id: binding.userId, paired_at: binding.pairedAtMs, agent_id: null };
    execute(
      kysely
        .insertInto("telegram_owner")
        .values({ id: ownerRow, ...row })
        .onConflict((conflict) => conflict.column("id").doUpdateSet(row)),
    );
    return replaced === undefined ? null : toBinding(replaced);
  },
});

/** Keeps the agent `/use` picked with the paired owner; false before any pairing. */
export const useAgentTask: StoreTask<string, boolean> = defineTask({
  name: "telegram.use_agent",
  access: "write",
  input: idSchema("agt"),
  output: z.boolean(),
  run(database, agent) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const changed = execute(
      kysely.updateTable("telegram_owner").set({ agent_id: agent }).where("id", "=", ownerRow),
    );
    return changedRows(changed) > 0;
  },
});
