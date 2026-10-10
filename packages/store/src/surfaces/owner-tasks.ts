import { type OwnerBinding, ownerBindingSchema } from "@binference/engine/surfaces";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// The table holds one row, `id = 1`, once the owner paired.
const ownerRow = 1;

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
    return row === undefined ? null : { userId: row.user_id, pairedAtMs: row.paired_at };
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
    const row = { user_id: binding.userId, paired_at: binding.pairedAtMs };
    execute(
      kysely
        .insertInto("telegram_owner")
        .values({ id: ownerRow, ...row })
        .onConflict((conflict) => conflict.column("id").doUpdateSet(row)),
    );
    return replaced === undefined
      ? null
      : { userId: replaced.user_id, pairedAtMs: replaced.paired_at };
  },
});
