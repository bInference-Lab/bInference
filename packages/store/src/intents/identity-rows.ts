import type { DatabaseSync } from "node:sqlite";
import { type Id, idSchema } from "@binference/core";
import { type IdentityRecord, identityRecordSchema } from "@binference/engine/sends";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// Converts an agent's identity between its record and its `identities` row (database spec,
// section 2.2; decision 0335).

/**
 * Writes the identity a registration's move carries, in the caller's transaction. An agent that
 * holds one already breaks the table's key, which throws `store.constraint` and rolls the move
 * back.
 */
export function insertIdentity(database: DatabaseSync, identity: IdentityRecord): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely.insertInto("identities").values({
      agent_id: identity.agentId,
      chain: identity.chain,
      registry: identity.registry,
      onchain_id: identity.onchainId,
      tx_hash: identity.txHash,
      registered_at: identity.registeredAtMs,
      file: identity.file,
    }),
  );
}

/** Reads an agent's identity, or `undefined` when it has none. */
export const identityOfTask: StoreTask<Id<"agt">, IdentityRecord | undefined> = defineTask({
  name: "intents.identityOf",
  access: "read",
  input: idSchema("agt"),
  output: identityRecordSchema.optional(),
  run(database, agent) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely.selectFrom("identities").selectAll().where("agent_id", "=", agent),
    );
    return row === undefined
      ? undefined
      : identityRecordSchema.parse({
          agentId: row.agent_id,
          chain: row.chain,
          registry: row.registry,
          onchainId: row.onchain_id,
          txHash: row.tx_hash,
          registeredAtMs: row.registered_at,
          file: row.file,
        });
  },
});
