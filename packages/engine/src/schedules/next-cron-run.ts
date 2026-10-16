import { wallClockOf } from "@binference/i18n";
import type { CronFields } from "./cron-fields.js";

const minuteMs = 60_000;
const hourMs = 3_600_000;
const dayMs = 86_400_000;
// A wall date lies within 14 hours behind and 12 hours ahead of its UTC date, so these two
// moments hold the offsets before and after any change of the clocks on that date.
const dateReachBeforeMs = 15 * hourMs;
const dateReachAfterMs = 37 * hourMs;
// Every zone moves its clocks by less than this, so a wall time this far before the start's own is
// always earlier than the start.
const shiftReachMs = 3 * hourMs;
// The longest wait between two runs of a valid expression: 29 February of a year past a century
// that skips its leap day, eight years on.
const searchDays = 8 * 366 + 1;

/** One wall date, as the moment its midnight would be in UTC. */
type WallDate = number;

// How far the zone's clocks are ahead of UTC at a moment, to the second.
function offsetAt(atMs: number, timeZone: string): number {
  const second = Math.floor(atMs / 1_000) * 1_000;
  const wall = wallClockOf(second, timeZone);
  const shown = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return shown - second;
}

function isDayOf(fields: CronFields, date: WallDate): boolean {
  const day = new Date(date);
  if (!fields.months.includes(day.getUTCMonth() + 1)) {
    return false;
  }
  const byDay = fields.days.includes(day.getUTCDate());
  const byWeekday = fields.weekdays.includes(day.getUTCDay());
  // A field that starts with `*` lists every day it allows, so both must hold.
  return fields.daysRestricted && fields.weekdaysRestricted
    ? byDay || byWeekday
    : byDay && byWeekday;
}

function showsWall(atMs: number, wallMs: number, timeZone: string): boolean {
  return atMs + offsetAt(atMs, timeZone) === wallMs;
}

// The first whole second from `from` to `to` that the later offset already holds: where the
// clocks jump past a wall time that does not exist.
function jumpBetween(
  span: { readonly from: number; readonly to: number; readonly after: number },
  timeZone: string,
): number {
  let low = span.from;
  let high = span.to;
  while (high - low > 1_000) {
    const middle = low + Math.floor((high - low) / 2 / 1_000) * 1_000;
    if (offsetAt(middle, timeZone) === span.after) {
      high = middle;
    } else {
      low = middle;
    }
  }
  return high;
}

/**
 * The moment a wall time on a date whose clocks change happens (decision 0231): its first
 * occurrence when it occurs twice, and the moment the clocks jump past it when it does not exist.
 */
function momentOnChangeDay(
  wallMs: number,
  offsets: { readonly before: number; readonly after: number },
  timeZone: string,
): number {
  const early = wallMs - Math.max(offsets.before, offsets.after);
  const late = wallMs - Math.min(offsets.before, offsets.after);
  if (showsWall(early, wallMs, timeZone)) {
    return early;
  }
  if (showsWall(late, wallMs, timeZone)) {
    return late;
  }
  return jumpBetween({ from: early, to: late, after: offsets.after }, timeZone);
}

// The first run on one wall date later than `afterMs`, or none.
function runOnDate(
  fields: CronFields,
  day: { readonly date: WallDate; readonly afterMs: number },
  timeZone: string,
): number | undefined {
  const { date, afterMs } = day;
  const before = offsetAt(date - dateReachBeforeMs, timeZone);
  const after = offsetAt(date + dateReachAfterMs, timeZone);
  const earliestWall = afterMs + before - shiftReachMs;
  for (const hour of fields.hours) {
    for (const minute of fields.minutes) {
      const wallMs = date + hour * hourMs + minute * minuteMs;
      const atMs =
        before === after ? wallMs - before : momentOnChangeDay(wallMs, { before, after }, timeZone);
      if (wallMs >= earliestWall && atMs > afterMs) {
        return atMs;
      }
    }
  }
  return undefined;
}

/**
 * The first run of a cron expression later than `afterMs`, on the wall clock of `timeZone`, an
 * IANA zone such as `Asia/Shanghai`; `undefined` when it never runs in the next eight years, such
 * as on 31 February. A wall time the clocks skip runs when they jump past it; one they show twice
 * runs once, at its first occurrence (decision 0231). Throws `i18n.bad_time_zone` for a zone Intl
 * does not know.
 */
export function nextCronRun(
  fields: CronFields,
  afterMs: number,
  timeZone: string,
): number | undefined {
  const start = wallClockOf(afterMs, timeZone);
  const first = Date.UTC(start.year, start.month - 1, start.day);
  for (let index = 0; index < searchDays; index += 1) {
    const date = first + index * dayMs;
    const run = isDayOf(fields, date) ? runOnDate(fields, { date, afterMs }, timeZone) : undefined;
    if (run !== undefined) {
      return run;
    }
  }
  return undefined;
}
