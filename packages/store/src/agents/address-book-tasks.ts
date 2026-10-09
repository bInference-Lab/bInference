import type { DatabaseSync } from "node:sqlite";
import { accountRefParts, accountRefSchema } from "@binference/chain";
import { err, type Id, ok, type Result } from "@binference/core";
import {
  type AddressEntryRecord,
  addressEntryRecordSchema,
  type AddressEntryRemoval,
  addressEntryRemovalSchema,
} from "@binference/engine/sends";
import type { Selectable } from "kysely";
import type { AddressBookTable, EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** Reads one `address_book` row as its entry. */
function toAddressEntry(row: Selectable<AddressBookTable>): AddressEntryRecord {
  return addressEntryRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    account: accountRefSchema.parse(`${row.chain}:${row.address}`),
    label: row.label,
    usableAtMs: row.usable_at,
    ...field("inCeilingAtMs", row.in_ceiling_at),
    createdAtMs: row.created_at,
  });
}

/** Reads an agent's live address book entries, oldest first. */
export function readAddressBook(
  database: DatabaseSync,
  agent: Id<"agt">,
): readonly AddressEntryRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const rows = kysely
    .selectFrom("address_book")
    .selectAll()
    .where("agent_id", "=", agent)
    .where("removed_at", "is", null)
    .orderBy("created_at")
    .orderBy("id");
  return execute(rows).rows.map(toAddressEntry);
}

// The rows that refuse an entry: a taken id, a live entry of the same account, or no agent.
function refusalOf(
  database: DatabaseSync,
  entry: AddressEntryRecord,
): "not_found" | "exists" | "saved" | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const { chain, address } = accountRefParts(entry.account);
  const agent = takeFirst(kysely.selectFrom("agents").select("id").where("id", "=", entry.agentId));
  const taken = takeFirst(
    kysely.selectFrom("address_book").select("id").where("id", "=", entry.id),
  );
  const held = takeFirst(
    kysely
      .selectFrom("address_book")
      .select("id")
      .where("agent_id", "=", entry.agentId)
      .where("chain", "=", chain)
      .where("address", "=", address)
      .where("removed_at", "is", null),
  );
  if (agent === undefined) {
    return "not_found";
  }
  if (taken !== undefined) {
    return "exists";
  }
  return held === undefined ? undefined : "saved";
}

/** Adds an entry to an agent's address book. */
export const addAddressTask: StoreTask<
  AddressEntryRecord,
  Result<AddressEntryRecord, "not_found" | "exists" | "saved">
> = defineTask({
  name: "agents.add_address",
  access: "write",
  input: addressEntryRecordSchema,
  output: resultSchema(addressEntryRecordSchema, ["not_found", "exists", "saved"]),
  run(database, entry) {
    const refusal = refusalOf(database, entry);
    if (refusal !== undefined) {
      return err(refusal);
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { chain, address } = accountRefParts(entry.account);
    execute(
      kysely.insertInto("address_book").values({
        id: entry.id,
        agent_id: entry.agentId,
        chain,
        address,
        label: entry.label,
        usable_at: entry.usableAtMs,
        in_ceiling_at: entry.inCeilingAtMs ?? null,
        created_at: entry.createdAtMs,
        removed_at: null,
      }),
    );
    return ok(entry);
  },
});

/** Removes a live entry from its agent's address book. */
export const removeAddressTask: StoreTask<
  AddressEntryRemoval,
  Result<AddressEntryRecord, "not_found">
> = defineTask({
  name: "agents.remove_address",
  access: "write",
  input: addressEntryRemovalSchema,
  output: resultSchema(addressEntryRecordSchema, ["not_found"]),
  run(database, removal) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("address_book")
        .selectAll()
        .where("id", "=", removal.id)
        .where("removed_at", "is", null),
    );
    if (row === undefined) {
      return err("not_found");
    }
    execute(
      kysely
        .updateTable("address_book")
        .set({ removed_at: removal.atMs })
        .where("id", "=", removal.id),
    );
    return ok(toAddressEntry(row));
  },
});
