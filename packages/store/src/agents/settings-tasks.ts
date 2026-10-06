import { err, ok, type Result } from "@binference/core";
import {
  type ApprovalModeChange,
  approvalModeChangeSchema,
  type ApprovalModeRecord,
  approvalModeRecordSchema,
  type LimitsChange,
  limitsChangeSchema,
  type LimitsRecord,
  limitsRecordSchema,
} from "@binference/engine";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { toApprovalMode } from "./agent-rows.js";
import { limitsColumns, toLimitsRecord } from "./limits-rows.js";

// A change names the row version it read: a missing row is `not_found`, another version `stale`.
function versioned<Row extends { readonly version: number }>(
  row: Row | undefined,
  expectedVersion: number,
): Result<Row, "not_found" | "stale"> {
  if (row === undefined) {
    return err("not_found");
  }
  return row.version === expectedVersion ? ok(row) : err("stale");
}

/** Sets an agent's approval mode under the version the changer read. */
export const setApprovalModeTask: StoreTask<
  ApprovalModeChange,
  Result<ApprovalModeRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_approval_mode",
  access: "write",
  input: approvalModeChangeSchema,
  output: resultSchema(approvalModeRecordSchema, ["not_found", "stale"]),
  run(database, change) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const found = versioned(
      takeFirst(
        kysely.selectFrom("approval_modes").selectAll().where("agent_id", "=", change.agentId),
      ),
      change.expectedVersion,
    );
    if (!found.ok) {
      return found;
    }
    const row = {
      ...found.value,
      mode: change.mode,
      changed_by_surface: change.bySurface,
      changed_at: change.atMs,
      version: change.expectedVersion + 1,
    };
    execute(kysely.updateTable("approval_modes").set(row).where("agent_id", "=", change.agentId));
    return ok(toApprovalMode(row));
  },
});

/** Sets an agent's limits under the version the changer read. */
export const setLimitsTask: StoreTask<
  LimitsChange,
  Result<LimitsRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_limits",
  access: "write",
  input: limitsChangeSchema,
  output: resultSchema(limitsRecordSchema, ["not_found", "stale"]),
  run(database, change) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const found = versioned(
      takeFirst(
        kysely.selectFrom("limits").select("version").where("agent_id", "=", change.agentId),
      ),
      change.expectedVersion,
    );
    if (!found.ok) {
      return found;
    }
    const row = {
      ...limitsColumns(change.limits),
      agent_id: change.agentId,
      changed_at: change.atMs,
      version: change.expectedVersion + 1,
    };
    execute(kysely.updateTable("limits").set(row).where("agent_id", "=", change.agentId));
    return ok(toLimitsRecord(row));
  },
});
