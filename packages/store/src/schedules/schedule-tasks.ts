import { err, type Id, idSchema, ok, type Result } from "@binference/core";
import {
  type DueQuery,
  dueQuerySchema,
  maxActiveSchedules,
  type ScheduleCancel,
  scheduleCancelSchema,
  type ScheduleQuery,
  scheduleQuerySchema,
  type ScheduleRecord,
  scheduleRecordSchema,
  type ScheduleRezone,
  scheduleRezoneSchema,
} from "@binference/engine/chat";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { readSchedule, scheduleRowOf, toScheduleRecord, writeSchedule } from "./schedule-rows.js";

const records = z.array(scheduleRecordSchema);

/** Stores a new active schedule while its agent holds fewer than 50. */
export const createScheduleTask: StoreTask<
  ScheduleRecord,
  Result<ScheduleRecord, "not_found" | "too_many">
> = defineTask({
  name: "schedules.create",
  access: "write",
  input: scheduleRecordSchema,
  output: resultSchema(scheduleRecordSchema, ["not_found", "too_many"]),
  run(database, schedule) {
    const { kysely, takeFirst, execute } = createSyncKysely<EngineTables>(database);
    const agent = takeFirst(
      kysely.selectFrom("agents").select("id").where("id", "=", schedule.agentId),
    );
    if (agent === undefined) {
      return err("not_found");
    }
    const held = takeFirst(
      kysely
        .selectFrom("schedules")
        .select((builder) => builder.fn.countAll<number>().as("count"))
        .where("agent_id", "=", schedule.agentId)
        .where("state", "=", "active"),
    );
    if ((held?.count ?? 0) >= maxActiveSchedules) {
      return err("too_many");
    }
    execute(kysely.insertInto("schedules").values(scheduleRowOf(schedule)));
    return ok(schedule);
  },
});

/** One schedule, or none. */
export const getScheduleTask: StoreTask<Id<"sch">, ScheduleRecord | undefined> = defineTask({
  name: "schedules.get",
  access: "read",
  input: idSchema("sch"),
  output: scheduleRecordSchema.optional(),
  run: (database, id) => readSchedule(database, id),
});

/** The active schedules, of one agent or all, oldest first. */
export const activeSchedulesTask: StoreTask<ScheduleQuery, readonly ScheduleRecord[]> = defineTask({
  name: "schedules.active",
  access: "read",
  input: scheduleQuerySchema,
  output: records,
  run(database, { agentId }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const active = kysely.selectFrom("schedules").selectAll().where("state", "=", "active");
    const ofAgent = agentId === undefined ? active : active.where("agent_id", "=", agentId);
    return execute(ofAgent.orderBy("created_at").orderBy("id")).rows.map(toScheduleRecord);
  },
});

/** The active schedules due by a time, the earliest first. */
export const dueSchedulesTask: StoreTask<DueQuery, readonly ScheduleRecord[]> = defineTask({
  name: "schedules.due",
  access: "read",
  input: dueQuerySchema,
  output: records,
  run(database, { atMs, limit }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const due = kysely
      .selectFrom("schedules")
      .selectAll()
      .where("state", "=", "active")
      .where("next_at", "<=", atMs)
      .orderBy("next_at")
      .orderBy("id")
      .limit(limit);
    return execute(due).rows.map(toScheduleRecord);
  },
});

/** Cancels an active schedule. */
export const cancelScheduleTask: StoreTask<ScheduleCancel, ScheduleRecord | undefined> = defineTask(
  {
    name: "schedules.cancel",
    access: "write",
    input: scheduleCancelSchema,
    output: scheduleRecordSchema.optional(),
    run(database, { id, atMs }) {
      const stored = readSchedule(database, id);
      if (stored?.state !== "active") {
        return undefined;
      }
      const { nextAtMs: _next, ...rest } = stored;
      return writeSchedule(database, { ...rest, state: "cancelled", changedAtMs: atMs });
    },
  },
);

/** Moves an active schedule's next run into a new zone while it is the one expected. */
export const rezoneScheduleTask: StoreTask<ScheduleRezone, ScheduleRecord | undefined> = defineTask(
  {
    name: "schedules.rezone",
    access: "write",
    input: scheduleRezoneSchema,
    output: scheduleRecordSchema.optional(),
    run(database, move) {
      const stored = readSchedule(database, move.id);
      if (stored?.state !== "active" || stored.nextAtMs !== move.expectedNextAtMs) {
        return undefined;
      }
      const { zone: _zone, ...rest } = stored;
      const zone = move.zone === undefined ? {} : { zone: move.zone };
      return writeSchedule(database, {
        ...rest,
        ...zone,
        nextAtMs: move.nextAtMs,
        changedAtMs: move.atMs,
      });
    },
  },
);
