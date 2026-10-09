import type { DatabaseSync } from "node:sqlite";
import type { Id } from "@binference/core";
import {
  type AgentRecord,
  agentRecordSchema,
  type AgentSettings,
  type ApprovalModeRecord,
  approvalModeRecordSchema,
} from "@binference/engine";
import { type SendLevelRecord, sendLevelRecordSchema } from "@binference/engine/sends";
import type { Selectable } from "kysely";
import type {
  AgentsTable,
  ApprovalModesTable,
  EngineTables,
  SendLevelsTable,
} from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, readJson } from "../rows/column-values.js";
import { toLimitsRecord } from "./limits-rows.js";

/** Reads one `agents` row as its record. */
export function toAgentRecord(row: Selectable<AgentsTable>): AgentRecord {
  return agentRecordSchema.parse({
    id: row.id,
    name: row.name,
    mode: row.mode,
    locale: row.locale,
    models: readJson(row.models),
    notifications: readJson(row.notifications),
    ...field("frozenAtMs", row.frozen_at),
    ...field("archivedAtMs", row.archived_at),
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

/** Reads one `approval_modes` row as its record. */
export function toApprovalMode(row: Selectable<ApprovalModesTable>): ApprovalModeRecord {
  return approvalModeRecordSchema.parse({
    agentId: row.agent_id,
    mode: row.mode,
    changedBySurface: row.changed_by_surface,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

/** Reads one `send_levels` row as its record; a pending level is both columns or neither. */
export function toSendLevel(row: Selectable<SendLevelsTable>): SendLevelRecord {
  const pending =
    row.pending_level === null || row.pending_at === null
      ? {}
      : { pending: { level: row.pending_level, atMs: row.pending_at } };
  return sendLevelRecordSchema.parse({
    agentId: row.agent_id,
    level: row.level,
    ...pending,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

/**
 * Reads an agent with its limits, approval mode and send level, or `undefined` when one of them
 * is missing.
 */
export function readSettings(database: DatabaseSync, id: Id<"agt">): AgentSettings | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const agent = takeFirst(kysely.selectFrom("agents").selectAll().where("id", "=", id));
  const limits = takeFirst(kysely.selectFrom("limits").selectAll().where("agent_id", "=", id));
  const mode = takeFirst(
    kysely.selectFrom("approval_modes").selectAll().where("agent_id", "=", id),
  );
  const level = takeFirst(kysely.selectFrom("send_levels").selectAll().where("agent_id", "=", id));
  if (agent === undefined || limits === undefined || mode === undefined || level === undefined) {
    return undefined;
  }
  return {
    agent: toAgentRecord(agent),
    limits: toLimitsRecord(limits),
    approvalMode: toApprovalMode(mode),
    sendLevel: toSendLevel(level),
  };
}
