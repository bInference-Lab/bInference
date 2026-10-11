import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type AgentKeyAttachment,
  agentKeyAttachmentSchema,
  type SealKeyRecord,
  sealKeyRecordSchema,
} from "@binference/engine/install";
import type { Updateable } from "kysely";
import { z } from "zod";
import type { CustodyTable, EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { hasCustody } from "./install-rows.js";

// Updates the custody row with its version raised, in the caller's transaction; an install with
// no custody row is `not_set_up` and changes nothing.
function updateCustody(
  database: DatabaseSync,
  columns: Omit<Updateable<CustodyTable>, "version">,
): Result<void, "not_set_up"> {
  if (!hasCustody(database)) {
    return err("not_set_up");
  }
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  execute(
    kysely
      .updateTable("custody")
      .set((row) => ({ ...columns, version: row("version", "+", 1) }))
      .where("id", "=", 1),
  );
  return ok(undefined);
}

/**
 * Records a new agent key in one transaction: the custody row's agent key quorum, its public half
 * and when it attached, with its version raised, and the signer of every wallet not archived. An
 * install with no custody row is `not_set_up` and changes nothing.
 */
export const attachTask: StoreTask<AgentKeyAttachment, Result<void, "not_set_up">> = defineTask({
  name: "install.attach",
  access: "write",
  input: agentKeyAttachmentSchema,
  output: resultSchema(z.undefined(), ["not_set_up"]),
  run(database, attachment) {
    const updated = updateCustody(database, {
      agent_quorum_id: attachment.agentQuorumId,
      agent_key_public: attachment.agentKeyPublic,
      attached_at: attachment.atMs,
    });
    if (!updated.ok) {
      return updated;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("wallets")
        .set({ signer_id: attachment.agentQuorumId })
        .where("archived_at", "is", null),
    );
    return ok(undefined);
  },
});

/**
 * Keeps the sealing key's public half in the custody row, with its version raised. An install
 * with no custody row is `not_set_up` and changes nothing.
 */
export const setSealKeyTask: StoreTask<SealKeyRecord, Result<void, "not_set_up">> = defineTask({
  name: "install.set_seal_key",
  access: "write",
  input: sealKeyRecordSchema,
  output: resultSchema(z.undefined(), ["not_set_up"]),
  run: (database, key) => updateCustody(database, { seal_key_public: key.sealKeyPublic }),
});
