// A schedule's row and its record, both ways, and the reads every schedule task shares.
import type { DatabaseSync } from "node:sqlite";
import { type ScheduleRecord, scheduleRecordSchema } from "@binference/engine/chat";
import type { Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type { SchedulesTable } from "../databases/schedule-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { field, jsonText, orNull, readJson } from "../rows/column-values.js";

function lastRunOf(row: Selectable<SchedulesTable>) {
  const { last_at: at, last_due_at: due, last_outcome: outcome, last_reason: reason } = row;
  return at === null || due === null || outcome === null
    ? {}
    : { lastRun: { due, at, outcome, ...field("reason", reason) } };
}

/** Reads one stored schedule back into its record. */
export function toScheduleRecord(row: Selectable<SchedulesTable>): ScheduleRecord {
  return scheduleRecordSchema.parse({
    id: row.id,
    agentId: row.agent_id,
    when: readJson(row.when),
    prompt: row.prompt,
    state: row.state,
    ...field("nextAtMs", row.next_at),
    ...field("zone", row.zone),
    createdBy: row.created_by,
    outsideContent: row.outside_content === 1,
    ...lastRunOf(row),
    ...field("lastMessageId", row.last_message_id),
    createdAtMs: row.created_at,
    changedAtMs: row.changed_at,
  });
}

/** A schedule record as its row stores it. */
export function scheduleRowOf(record: ScheduleRecord): Selectable<SchedulesTable> {
  const { lastRun } = record;
  return {
    id: record.id,
    agent_id: record.agentId,
    when: jsonText(record.when),
    prompt: record.prompt,
    state: record.state,
    next_at: orNull(record.nextAtMs),
    zone: orNull(record.zone),
    last_at: orNull(lastRun?.at),
    last_due_at: orNull(lastRun?.due),
    last_outcome: orNull(lastRun?.outcome),
    last_reason: orNull(lastRun?.reason),
    last_message_id: orNull(record.lastMessageId),
    created_by: record.createdBy,
    outside_content: record.outsideContent ? 1 : 0,
    created_at: record.createdAtMs,
    changed_at: record.changedAtMs,
  };
}

/** One schedule in any state, or `undefined`. */
export function readSchedule(database: DatabaseSync, id: string): ScheduleRecord | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(kysely.selectFrom("schedules").selectAll().where("id", "=", id));
  return row === undefined ? undefined : toScheduleRecord(row);
}

/** Writes a schedule's row as its record now holds it, and reads it back. */
export function writeSchedule(database: DatabaseSync, record: ScheduleRecord): ScheduleRecord {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { id: _id, ...row } = scheduleRowOf(record);
  execute(kysely.updateTable("schedules").set(row).where("id", "=", record.id));
  return record;
}
