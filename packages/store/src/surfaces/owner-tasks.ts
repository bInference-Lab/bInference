import { err, ok, type Result } from "@binference/core";
import { type OwnerBinding, ownerBindingSchema } from "@binference/engine/surfaces";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
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

/** Binds the owner; an owner bound already stays, and the task answers `bound`. */
export const bindOwnerTask: StoreTask<OwnerBinding, Result<OwnerBinding, "bound">> = defineTask({
  name: "telegram.bind_owner",
  access: "write",
  input: ownerBindingSchema,
  output: resultSchema(ownerBindingSchema, ["bound"]),
  run(database, binding) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const bound = takeFirst(kysely.selectFrom("telegram_owner").select("id"));
    if (bound !== undefined) {
      return err("bound");
    }
    execute(
      kysely
        .insertInto("telegram_owner")
        .values({ id: ownerRow, user_id: binding.userId, paired_at: binding.pairedAtMs }),
    );
    return ok(binding);
  },
});
