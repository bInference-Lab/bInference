import { type JsonValue, jsonValueSchema } from "@binference/core";
import { type ScheduleView, scheduleViewSchema } from "@binference/protocol";
import { z } from "zod";
import type { ScheduleRecord } from "./schedule-record.js";

/** A stored schedule as `schedule/list` and `schedule/create` answer it. */
export function scheduleViewOf(schedule: ScheduleRecord): ScheduleView {
  const { id, agentId, when, prompt, state, nextAtMs, lastRun, createdAtMs, outsideContent } =
    schedule;
  return {
    schedule: id,
    agent: agentId,
    when,
    prompt,
    state,
    ...(nextAtMs === undefined ? {} : { nextAt: nextAtMs }),
    ...(lastRun === undefined ? {} : { lastAt: lastRun.at, lastRun }),
    createdAt: createdAtMs,
    outsideContent,
  };
}

/** A schedule's view as JSON, as the config journal keeps it. */
export function scheduleJson(schedule: ScheduleRecord): JsonValue {
  return jsonValueSchema.parse(z.encode(scheduleViewSchema, scheduleViewOf(schedule)));
}
