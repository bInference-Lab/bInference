// An alert's row and its record, both ways, and the reads every alert task shares.
import type { DatabaseSync } from "node:sqlite";
import {
  alertConditionDocument,
  type AlertRecord,
  alertRecordSchema,
} from "@binference/engine/orders";
import type { Selectable } from "kysely";
import type { AlertsTable } from "../databases/alert-tables.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, orNull, readJson } from "../rows/column-values.js";

/** Reads one stored alert back into its record. */
export function toAlertRecord(row: Selectable<AlertsTable>): AlertRecord {
  return alertRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    condition: readJson(row.condition),
    state: row.state,
    wake: row.wake === 1,
    fires: row.fires,
    outsideContent: row.outside_content === 1,
    createdBy: row.created_by,
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
    ...field("firedAtMs", row.fired_at),
    ...field("expiresAtMs", row.expires_at),
    ...field("lastMessageId", row.last_message_id),
  });
}

/** An alert record as its row stores it: its condition as the protocol's JSON writes it. */
export function alertRowOf(record: AlertRecord): Selectable<AlertsTable> {
  const { condition } = record;
  return {
    id: record.id,
    agent_id: record.agentId,
    condition: jsonText(alertConditionDocument.encode(condition)),
    kind: condition.kind,
    account: condition.kind === "wallet" ? condition.account : null,
    state: record.state,
    wake: record.wake ? 1 : 0,
    fires: record.fires,
    outside_content: record.outsideContent ? 1 : 0,
    created_by: record.createdBy,
    created_at: record.createdAtMs,
    changed_at: record.changedAtMs,
    fired_at: orNull(record.firedAtMs),
    expires_at: orNull(record.expiresAtMs),
    last_message_id: orNull(record.lastMessageId),
  };
}

/** One alert in any state, or `undefined`. */
export function readAlert(database: DatabaseSync, id: string): AlertRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("alerts").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toAlertRecord(row);
}

/** Writes an alert's row as its record now holds it, and reads it back. */
export function writeAlert(database: DatabaseSync, record: AlertRecord): AlertRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { id: _id, ...row } = alertRowOf(record);
  execute(kysely.updateTable("alerts").set(row).where("id", "=", record.id));
  return record;
}
