import type { Id, Result } from "@binference/core";
import type { ScheduleRun, ScheduleSkip } from "@binference/protocol";
import type { ScheduleRecord, ScheduleRunDraft } from "./schedule-record.js";

/**
 * A schedule as one run leaves it, which every store adapter writes: the run's outcome, the
 * wake-up it stored when it sent one, and its next run in its zone, or `ended` with none.
 */
export function scheduleAfterRun(
  schedule: ScheduleRecord,
  run: ScheduleRunDraft,
  woke: Result<Id<"msg">, ScheduleSkip>,
): ScheduleRecord {
  const due = { due: run.dueAtMs, at: run.atMs };
  const lastRun: ScheduleRun = woke.ok
    ? { ...due, outcome: "sent" }
    : { ...due, outcome: "skipped", reason: woke.error };
  const { nextAtMs: _next, ...rest } = schedule;
  const sent = woke.ok ? { lastMessageId: woke.value } : {};
  const base = { ...rest, ...sent, lastRun, changedAtMs: run.atMs };
  if (run.next === undefined) {
    return { ...base, state: "ended" };
  }
  const { zone: _zone, ...unzoned } = base;
  const zone = run.next.zone === undefined ? {} : { zone: run.next.zone };
  return { ...unzoned, ...zone, nextAtMs: run.next.nextAtMs };
}
