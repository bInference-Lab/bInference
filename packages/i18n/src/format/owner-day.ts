import { wallClockOf } from "./wall-clock.js";

const secondMs = 1_000;
// Every zone's offset from UTC lies within 18 hours, so a date's first moment lies within 18 hours
// of the same date's midnight in UTC.
const reachMs = 18 * 3_600_000;

// The wall date a moment shows in the zone, as the moment its midnight would be in UTC.
function dateOf(atMs: number, timeZone: string): number {
  const wall = wallClockOf(atMs, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day);
}

// The first whole second whose wall date in the zone is `date` or later. Where a change of the
// clocks skips midnight, the day starts when the clocks show its date at last, such as 01:00.
function firstMomentOf(date: number, timeZone: string): number {
  let before = date - reachMs;
  let from = date + reachMs;
  while (from - before > secondMs) {
    const middle = before + Math.floor((from - before) / 2 / secondMs) * secondMs;
    if (dateOf(middle, timeZone) >= date) {
      from = middle;
    } else {
      before = middle;
    }
  }
  return from;
}

/**
 * When the owner's day that holds `atMs` starts, in `timeZone`, an IANA zone such as
 * `Asia/Shanghai`: the zone's midnight, or the first moment of the date where the clocks skip
 * midnight. A day is 23 or 25 hours long across a change of the clocks. Throws
 * `i18n.bad_time_zone` for a zone Intl does not know.
 */
export function dayStartOf(atMs: number, timeZone: string): number {
  return firstMomentOf(dateOf(atMs, timeZone), timeZone);
}

/** When the owner's next day after the one that holds `atMs` starts: the owner's next midnight. */
export function nextDayStartOf(atMs: number, timeZone: string): number {
  const date = new Date(dateOf(atMs, timeZone));
  date.setUTCDate(date.getUTCDate() + 1);
  return firstMomentOf(date.getTime(), timeZone);
}

/** When the owner's month that holds `atMs` starts: the first moment of its first day. */
export function monthStartOf(atMs: number, timeZone: string): number {
  const wall = wallClockOf(atMs, timeZone);
  return firstMomentOf(Date.UTC(wall.year, wall.month - 1, 1), timeZone);
}
