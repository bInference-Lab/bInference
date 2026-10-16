import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type AgentInboxMessage,
  agentInboxMessageSchema,
  maxUntakenMessages,
  scheduleAfterRun,
  type ScheduleRecord,
  scheduleRecordSchema,
  type ScheduleRunDraft,
  scheduleRunDraftSchema,
  type ScheduleRunWritten,
} from "@binference/engine/chat";
import { z } from "zod";
import { insertMessage, sessionFor, untakenCount } from "../agent-inbox/agent-inbox-writes.js";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readSchedule, writeSchedule } from "./schedule-rows.js";

function isUntaken(database: DatabaseSync, id: string | undefined): boolean {
  if (id === undefined) {
    return false;
  }
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("agent_inbox")
      .select("id")
      .where("id", "=", id)
      .where("taken_at", "is", null),
  );
  return row !== undefined;
}

// Stores the run's wake-up in the agent's open session, unless the last one still waits or the
// agent inbox is full.
function wake(
  database: DatabaseSync,
  schedule: ScheduleRecord,
  run: ScheduleRunDraft,
): Result<AgentInboxMessage, NonNullable<ScheduleRunDraft["skip"]>> {
  if (run.skip !== undefined) {
    return err(run.skip);
  }
  if (isUntaken(database, schedule.lastMessageId)) {
    return err("waiting");
  }
  if (untakenCount(database, schedule.agentId) >= maxUntakenMessages) {
    return err("busy");
  }
  const { id, turnId, opens, payload } = run.wake;
  const sessionId = sessionFor(database, schedule.agentId, opens) ?? opens;
  return ok(
    insertMessage(database, {
      id,
      agentId: schedule.agentId,
      sessionId,
      kind: "inbox/scheduleDue",
      turnId,
      payload,
      createdAtMs: run.atMs,
    }),
  );
}

/**
 * Records one run of a schedule still due at the run's time, stores its wake-up unless it skips,
 * and moves the schedule on, in one transaction.
 */
export const runScheduleTask: StoreTask<
  ScheduleRunDraft,
  Result<ScheduleRunWritten, "stale">
> = defineTask({
  name: "schedules.run",
  access: "write",
  input: scheduleRunDraftSchema,
  output: resultSchema(
    z.strictObject({
      schedule: scheduleRecordSchema,
      message: agentInboxMessageSchema.exactOptional(),
    }),
    ["stale"],
  ),
  run(database, run) {
    const schedule = readSchedule(database, run.id);
    if (schedule?.state !== "active" || schedule.nextAtMs !== run.dueAtMs) {
      return err("stale");
    }
    const woke = wake(database, schedule, run);
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely.insertInto("schedule_runs").values({
        schedule_id: run.id,
        due_at: run.dueAtMs,
        at: run.atMs,
        outcome: woke.ok ? "sent" : "skipped",
        reason: woke.ok ? null : woke.error,
        message_id: woke.ok ? woke.value.id : null,
      }),
    );
    const after = scheduleAfterRun(schedule, run, woke.ok ? ok(woke.value.id) : woke);
    const written = writeSchedule(database, after);
    return ok(woke.ok ? { schedule: written, message: woke.value } : { schedule: written });
  },
});
