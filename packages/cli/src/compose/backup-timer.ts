import { BinferenceError, type Clock, err, type Logger, type Result } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import {
  backupFailedNotice,
  type BackupFailure,
  type BackupRecord,
} from "@binference/engine/backups";
import { backupKindAt, nextBackupAt, type ScheduledBackup } from "../backups/backup-schedule.js";
import type { Closers } from "./closers.js";

/** What the nightly backup reads each night, from the config as it stands then. */
export interface BackupSchedule {
  /** `backups.daily`: whether the night's backup runs at all. */
  readonly isOn: boolean;
  /** `owner.timezone`, whose 03:30 the backup runs at. */
  readonly timeZone: string;
}

/** What the timer runs, and what it runs on. */
export interface BackupTimerOptions {
  /** Takes one scheduled backup of the kind given. */
  readonly takeBackup: (
    kind: ScheduledBackup["kind"],
    signal: AbortSignal,
  ) => Promise<Result<BackupRecord, BackupFailure>>;
  /** Whether a night was missed: the newest scheduled backup is more than 24 hours old. */
  readonly isNightMissed: (signal: AbortSignal) => Promise<boolean>;
  readonly schedule: () => BackupSchedule;
  /** Where a failed backup's notice goes: the engine's one publish. */
  readonly publish: PublishPush;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// The timer ticks each minute: it looks at the owner's timezone again, and a tick that finds the
// wall clock moved more than 5 minutes past its sleep is a wake from sleep. A sleeping machine
// stops the timer's sleep, never the wall clock.
const tickMs = 60_000;
const wakeJumpMs = 5 * 60_000;

// Reads whether a night was missed; a read that fails is logged and taken as none missed, and one
// a stop cut off is neither.
async function nightMissed(options: BackupTimerOptions, stop: AbortSignal): Promise<boolean> {
  if (!options.schedule().isOn) {
    return false;
  }
  try {
    return await options.isNightMissed(stop);
  } catch (error) {
    if (stop.aborted) {
      return false;
    }
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("backup.history_unread", { errorCode });
    return false;
  }
}

// Sleeps one tick, at most until the next backup is due; answers whether the machine woke.
async function tick(clock: Clock, dueAtMs: number, stop: AbortSignal): Promise<boolean> {
  const before = clock.now();
  const delayMs = Math.min(Math.max(dueAtMs - before, 0), tickMs);
  await clock.sleep(delayMs, stop).catch(() => undefined);
  return clock.now() - before > delayMs + wakeJumpMs;
}

// Waits until a backup is due: 03:30 came, or a wake found a night missed. False once stopped.
async function waitFor(options: BackupTimerOptions, stop: AbortSignal): Promise<boolean> {
  const { clock } = options;
  let zone = options.schedule().timeZone;
  let next = nextBackupAt(clock.now(), zone);
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one tick at a time, until a backup is due
    const woke = await tick(clock, next.atMs, stop);
    if (stop.aborted) {
      return false;
    }
    const now = options.schedule().timeZone;
    if (now !== zone) {
      zone = now;
      next = nextBackupAt(clock.now(), zone);
      continue;
    }
    // oxlint-disable-next-line eslint/no-await-in-loop -- the history is read only after a wake
    if (clock.now() >= next.atMs || (woke && (await nightMissed(options, stop)))) {
      return true;
    }
  }
}

async function take(
  options: BackupTimerOptions,
  kind: ScheduledBackup["kind"],
  stop: AbortSignal,
): Promise<Result<BackupRecord, BackupFailure>> {
  try {
    return await options.takeBackup(kind, stop);
  } catch (error) {
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    options.logger.warn("backup.failed", { errorCode });
    return err("write");
  }
}

// Takes the backup that is due, named by the owner's day now, and raises a failure's notice.
async function takeDue(options: BackupTimerOptions, stop: AbortSignal): Promise<void> {
  const kind = backupKindAt(options.clock.now(), options.schedule().timeZone);
  const taken = await take(options, kind, stop);
  if (!stop.aborted && !taken.ok) {
    options.publish(backupFailedNotice(taken.error));
  }
}

// One round: the wait until 03:30 or a wake that finds a night missed, then the backup when the
// switch is on, then the next round.
async function oneRound(
  options: BackupTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = run;
  if (!(await waitFor(options, stop))) {
    return;
  }
  if (options.schedule().isOn) {
    await takeDue(options, stop);
  }
  if (!stop.aborted) {
    run.next();
  }
}

// At the start, a missed night's backup at once, then the rounds.
async function firstRound(
  options: BackupTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  if (await nightMissed(options, run.stop)) {
    await takeDue(options, run.stop);
  }
  await oneRound(options, run);
}

/**
 * Takes the nightly backup at 03:30 owner time while the engine serves (keys spec, section 7.3),
 * one taken on a Sunday as the weekly one, when `backups.daily` is on. When the engine starts, or
 * the machine wakes from sleep, and the newest scheduled backup is more than 24 hours old, it
 * takes one at once. It reads the switch and the timezone from the config each time, so a reload
 * applies within a minute. A backup that fails, or whose check fails, raises
 * `notice.backupFailed` with the reason. A locked engine backs up too: a backup needs no key the
 * lock holds. Its closer stops it and waits for a backup under way.
 */
export function startBackupTimer(options: BackupTimerOptions): void {
  const stop = new AbortController();
  const timer = { running: Promise.resolve() };
  // Each round starts the next once it ends, and nothing waits on it, so the rounds never chain
  // up however long the engine serves.
  const next = (): void => {
    timer.running = oneRound(options, { stop: stop.signal, next });
  };
  timer.running = firstRound(options, { stop: stop.signal, next });
  options.closers.add("backups", async () => {
    stop.abort();
    await timer.running;
  });
}
