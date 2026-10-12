import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type AgentModeChange,
  agentModeChangeSchema,
  type AgentRecord,
  agentRecordSchema,
  type ApprovalModeChange,
  approvalModeChangeSchema,
  type ApprovalModeRecord,
  approvalModeRecordSchema,
  type LimitsChange,
  limitsChangeSchema,
  type LimitsRecord,
  limitsRecordSchema,
} from "@binference/engine";
import { type AgentModelsChange, agentModelsChangeSchema } from "@binference/engine/chat";
import {
  type AgentNotificationsChange,
  agentNotificationsChangeSchema,
} from "@binference/engine/notices";
import {
  type SendLevelChange,
  sendLevelChangeSchema,
  type SendLevelRecord,
  sendLevelRecordSchema,
} from "@binference/engine/sends";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { jsonText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { toAgentRecord, toApprovalMode, toSendLevel } from "./agent-rows.js";
import { limitsColumns, pendingColumns, toLimitsRecord } from "./limits-rows.js";

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

/** Sets an agent's limits and the ones that wait under the version the changer read. */
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
      ...pendingColumns(change.pending),
      agent_id: change.agentId,
      changed_at: change.atMs,
      version: change.expectedVersion + 1,
    };
    execute(kysely.updateTable("limits").set(row).where("agent_id", "=", change.agentId));
    return ok(toLimitsRecord(row));
  },
});

// Writes columns of the agent row under the version the changer read, and raises that version.
function setAgentRow(
  database: DatabaseSync,
  change: AgentModeChange | AgentNotificationsChange | AgentModelsChange,
  columns: { readonly mode?: string; readonly notifications?: string; readonly models?: string },
): Result<AgentRecord, "not_found" | "stale"> {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  const found = versioned(
    takeFirst(kysely.selectFrom("agents").selectAll().where("id", "=", change.agentId)),
    change.expectedVersion,
  );
  if (!found.ok) {
    return found;
  }
  const row = {
    ...found.value,
    ...columns,
    changed_at: change.atMs,
    version: change.expectedVersion + 1,
  };
  execute(kysely.updateTable("agents").set(row).where("id", "=", change.agentId));
  return ok(toAgentRecord(row));
}

/** Sets an agent's mode under the agent row's version the changer read. */
export const setModeTask: StoreTask<
  AgentModeChange,
  Result<AgentRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_mode",
  access: "write",
  input: agentModeChangeSchema,
  output: resultSchema(agentRecordSchema, ["not_found", "stale"]),
  run: (database, change) => setAgentRow(database, change, { mode: change.mode }),
});

/** Sets an agent's notice settings under the agent row's version the changer read. */
export const setNotificationsTask: StoreTask<
  AgentNotificationsChange,
  Result<AgentRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_notifications",
  access: "write",
  input: agentNotificationsChangeSchema,
  output: resultSchema(agentRecordSchema, ["not_found", "stale"]),
  run: (database, change) =>
    setAgentRow(database, change, { notifications: jsonText(change.notifications) }),
});

/** Sets the models the owner picked for an agent under the agent row's version the changer read. */
export const setModelsTask: StoreTask<
  AgentModelsChange,
  Result<AgentRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_models",
  access: "write",
  input: agentModelsChangeSchema,
  output: resultSchema(agentRecordSchema, ["not_found", "stale"]),
  run: (database, change) => setAgentRow(database, change, { models: jsonText(change.models) }),
});

/** Writes an agent's send level and any pending level under the version the changer read. */
export const setSendLevelTask: StoreTask<
  SendLevelChange,
  Result<SendLevelRecord, "not_found" | "stale">
> = defineTask({
  name: "agents.set_send_level",
  access: "write",
  input: sendLevelChangeSchema,
  output: resultSchema(sendLevelRecordSchema, ["not_found", "stale"]),
  run(database, change) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const found = versioned(
      takeFirst(
        kysely.selectFrom("send_levels").select("version").where("agent_id", "=", change.agentId),
      ),
      change.expectedVersion,
    );
    if (!found.ok) {
      return found;
    }
    const row = {
      agent_id: change.agentId,
      level: change.level,
      pending_level: change.pending?.level ?? null,
      pending_at: change.pending?.atMs ?? null,
      changed_at: change.atMs,
      version: change.expectedVersion + 1,
    };
    execute(kysely.updateTable("send_levels").set(row).where("agent_id", "=", change.agentId));
    return ok(toSendLevel(row));
  },
});
