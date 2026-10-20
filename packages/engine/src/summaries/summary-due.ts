import { dayStartOf, wallClockOf } from "@binference/i18n";
import { parseCron } from "../schedules/cron-fields.js";
import { nextCronRun } from "../schedules/next-cron-run.js";

/** The owner's date a moment falls on, and when that date's daily summary is due. */
export interface SummaryDue {
  /** `YYYY-MM-DD` on the owner's wall clock. */
  readonly date: string;
  readonly dueAtMs: number;
}

const twoDigits = (value: number): string => String(value).padStart(2, "0");

/**
 * The owner's date at `nowMs` in `timeZone`, and the moment its daily summary is due: `time`,
 * `HH:mm`, on that date's wall clock, as a schedule runs (decision 0231). Where the clocks skip
 * that time, it is due at the jump; where they show it twice, at its first. Throws
 * `i18n.bad_time_zone` for a zone Intl does not know.
 */
export function summaryDueOn(nowMs: number, timeZone: string, time: string): SummaryDue {
  const wall = wallClockOf(nowMs, timeZone);
  const date = `${String(wall.year)}-${twoDigits(wall.month)}-${twoDigits(wall.day)}`;
  const dayStartMs = dayStartOf(nowMs, timeZone);
  const [hours, minutes] = time.split(":");
  // The notice settings keep the time as HH:mm, so the expression always reads; a wall time runs
  // on every date, so its first run from the date's start is that date's.
  const fields = parseCron(`${minutes ?? ""} ${hours ?? ""} * * *`);
  const dueAtMs = fields.ok ? nextCronRun(fields.value, dayStartMs - 1, timeZone) : undefined;
  return { date, dueAtMs: dueAtMs ?? dayStartMs };
}
