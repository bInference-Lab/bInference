import { wallClockOf } from "@binference/i18n";

/** When the next scheduled backup runs, and its kind: Sunday's is the week's. */
export interface ScheduledBackup {
  readonly atMs: number;
  readonly kind: "daily" | "weekly";
}

const dayMs = 86_400_000;
// Keys spec, section 7.3: every day at 03:30 owner time.
const atHour = 3;
const atMinute = 30;

interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

// How far the zone's wall clock is ahead of UTC at a moment, in milliseconds.
function offsetAt(atMs: number, timeZone: string): number {
  const wall = wallClockOf(atMs, timeZone);
  const shown = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return shown - (atMs - (atMs % 1_000));
}

// The moment the zone's wall clock shows 03:30 on a date. Where 03:30 is skipped that day, the
// moment an hour off it; where it comes twice, the first.
function backupMomentOn(date: LocalDate, timeZone: string): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, atHour, atMinute);
  const guess = wall - offsetAt(wall, timeZone);
  return wall - offsetAt(guess, timeZone);
}

/**
 * The next scheduled backup strictly after `nowMs` (keys spec, section 7.3): 03:30 on the owner's
 * wall clock in `timeZone`, an IANA zone such as `Asia/Shanghai`. The one that falls on a Sunday
 * there is `weekly`, every other `daily`.
 */
export function nextBackupAt(nowMs: number, timeZone: string): ScheduledBackup {
  const todays = backupMomentOn(wallClockOf(nowMs, timeZone), timeZone);
  const atMs =
    todays > nowMs ? todays : backupMomentOn(wallClockOf(todays + dayMs, timeZone), timeZone);
  return { atMs, kind: wallClockOf(atMs, timeZone).weekday === 0 ? "weekly" : "daily" };
}
