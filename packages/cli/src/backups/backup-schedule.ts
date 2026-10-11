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
 * The kind of a scheduled backup taken at `atMs` (keys spec, section 7.3): `weekly` on a Sunday on
 * the owner's wall clock in `timeZone`, `daily` on every other day. Retention counts a weekly one
 * among the daily ones too.
 */
export function backupKindAt(atMs: number, timeZone: string): ScheduledBackup["kind"] {
  return wallClockOf(atMs, timeZone).weekday === 0 ? "weekly" : "daily";
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
  return { atMs, kind: backupKindAt(atMs, timeZone) };
}

/** What decides whether a night's backup was missed. */
export interface NightlyHistory {
  /** When the newest scheduled backup, daily or weekly, was taken and verified, if any was. */
  readonly newestMs?: number;
  /** When this machine's agent key became the wallets' signer: the start of its backups. */
  readonly attachedAtMs: number;
}

/**
 * Whether a night's backup was missed (keys spec, section 7.3): the newest scheduled backup is
 * more than 24 hours older than `nowMs`, or, with none yet, the install was attached to this
 * machine more than 24 hours before. The machine was off or asleep at 03:30, or the engine down.
 */
export function isNightMissed(nowMs: number, history: NightlyHistory): boolean {
  return nowMs - (history.newestMs ?? history.attachedAtMs) > dayMs;
}
