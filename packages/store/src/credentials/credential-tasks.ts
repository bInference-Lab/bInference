import {
  type CredentialEntry,
  type CredentialPut,
  credentialEntrySchema,
  credentialPutSchema,
  type RevealedCredentialRow,
  revealedCredentialRowSchema,
} from "@binference/engine/chat";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

const hostsSchema = z.array(z.string()).readonly();
const atMsSchema = z.int().nonnegative();

function entryOf(row: {
  readonly name: string;
  readonly allowed_hosts: string;
  readonly updated_at: number;
}): CredentialEntry {
  return {
    name: row.name,
    allowedHosts: hostsSchema.parse(JSON.parse(row.allowed_hosts)),
    updatedAtMs: row.updated_at,
  };
}

/** Every stored credential by name, its value aside; a removed one is not listed. */
export const listCredentialsTask: StoreTask<null, readonly CredentialEntry[]> = defineTask({
  name: "credentials.list",
  access: "read",
  input: z.null(),
  output: z.array(credentialEntrySchema).readonly(),
  run(database) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const query = kysely
      .selectFrom("credentials")
      .select(["name", "allowed_hosts", "updated_at"])
      .where("deleted_at", "is", null)
      .orderBy("name");
    return execute(query).rows.map(entryOf);
  },
});

/** One stored credential by name, its value aside, or null; a removed one is null. */
export const getCredentialTask: StoreTask<string, CredentialEntry | null> = defineTask({
  name: "credentials.get",
  access: "read",
  input: z.string(),
  output: credentialEntrySchema.nullable(),
  run(database, name) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("credentials")
        .select(["name", "allowed_hosts", "updated_at"])
        .where("name", "=", name)
        .where("deleted_at", "is", null),
    );
    return row === undefined ? null : entryOf(row);
  },
});

/** One stored credential by name with its value, or null; a removed one is null. */
export const revealCredentialTask: StoreTask<string, RevealedCredentialRow | null> = defineTask({
  name: "credentials.reveal",
  access: "read",
  input: z.string(),
  output: revealedCredentialRowSchema.nullable(),
  run(database, name) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("credentials")
        .select(["name", "value", "allowed_hosts"])
        .where("name", "=", name)
        .where("deleted_at", "is", null),
    );
    return row === undefined
      ? null
      : {
          name: row.name,
          value: row.value,
          allowedHosts: hostsSchema.parse(JSON.parse(row.allowed_hosts)),
        };
  },
});

/** Stores a credential in place of any of its name, a removed one too. */
export const putCredentialTask: StoreTask<CredentialPut, null> = defineTask({
  name: "credentials.put",
  access: "write",
  input: credentialPutSchema,
  output: z.null(),
  run(database, put) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const row = {
      value: put.value,
      allowed_hosts: JSON.stringify(put.allowedHosts),
      updated_at: put.atMs,
      deleted_at: null,
    };
    execute(
      kysely
        .insertInto("credentials")
        .values({ name: put.name, ...row })
        .onConflict((conflict) => conflict.column("name").doUpdateSet(row)),
    );
    return null;
  },
});

/** Removes a credential at a time; false when none of the name was stored. */
export const removeCredentialTask: StoreTask<
  { readonly name: string; readonly atMs: number },
  boolean
> = defineTask({
  name: "credentials.remove",
  access: "write",
  input: z.strictObject({ name: z.string(), atMs: atMsSchema }),
  output: z.boolean(),
  run(database, { name, atMs }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const result = execute(
      kysely
        .updateTable("credentials")
        .set({ deleted_at: atMs })
        .where("name", "=", name)
        .where("deleted_at", "is", null),
    );
    return Number(result.numAffectedRows ?? 0n) > 0;
  },
});

/** Drops, with their values, the credentials removed before a time; answers how many. */
export const purgeCredentialsTask: StoreTask<number, number> = defineTask({
  name: "credentials.purge",
  access: "write",
  input: atMsSchema,
  output: z.int().nonnegative(),
  run(database, beforeMs) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const result = execute(
      kysely
        .deleteFrom("credentials")
        .where("deleted_at", "is not", null)
        .where("deleted_at", "<", beforeMs),
    );
    return Number(result.numAffectedRows ?? 0n);
  },
});
