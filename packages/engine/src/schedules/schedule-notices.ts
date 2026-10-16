import type { EnginePush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { ScheduleRecord } from "./schedule-record.js";

/** The notice that a schedule was set (spec 4, section 4; decision 0233). */
const scheduleSetKey = "notice.scheduleSet";

/** The notice that a schedule was cancelled (spec 4, section 4; decision 0233). */
const scheduleCancelledKey = "notice.scheduleCancelled";

/**
 * Who changed a schedule, as its notice names them: `agent` for the agent runtime, else the
 * surface the owner used (`telegram`, `console`, `mini`, `cli`).
 */
export interface ScheduleMover {
  readonly agentName: string;
  readonly by: string;
}

/** The notice that announces a new schedule on every surface, with its next run. */
export function scheduleSetNotice(schedule: ScheduleRecord, mover: ScheduleMover): EnginePush {
  const values = { agent: mover.agentName, by: mover.by, prompt: schedule.prompt };
  const times = schedule.nextAtMs === undefined ? {} : { times: { next: schedule.nextAtMs } };
  return noticePush({ key: scheduleSetKey, agent: schedule.agentId, values, ...times });
}

/** The notice that announces a cancelled schedule on every surface. */
export function scheduleCancelledNotice(
  schedule: ScheduleRecord,
  mover: ScheduleMover,
): EnginePush {
  const values = { agent: mover.agentName, by: mover.by, prompt: schedule.prompt };
  return noticePush({ key: scheduleCancelledKey, agent: schedule.agentId, values });
}
