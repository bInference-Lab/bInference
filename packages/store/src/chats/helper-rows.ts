import type { Selectable } from "kysely";
import type { AgentTables, HelpersTable } from "../databases/agent-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field } from "../rows/column-values.js";
import { type HelperRecord, helperRecordSchema } from "./helper-record.js";

/** A `helpers` row as its record. */
export function toHelper(row: Selectable<HelpersTable>): HelperRecord {
  return helperRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    parentSessionId: row.parent_session_id,
    label: row.label,
    ...field("model", row.model),
    state: row.state,
    startedAtMs: row.started_at,
    ...field("endedAtMs", row.ended_at),
    timeoutMs: row.timeout_ms,
    runs: row.runs,
    outside: row.outside === 1,
  });
}

/** One helper row, read inside the caller's transaction. */
export function readHelper(database: StoreConnection, id: string): HelperRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<AgentTables>(database);
  const row = takeFirst(kysely.selectFrom("helpers").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toHelper(row);
}
