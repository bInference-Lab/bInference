import { BinferenceError, type Clock, err, type Logger, type Result } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import {
  backupFailedNotice,
  type BackupFailure,
  type BackupRecord,
} from "@binference/engine/backups";
import { nextBackupAt, type ScheduledBackup } from "../backups/backup-schedule.js";
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
  readonly schedule: () => BackupSchedule;
  /** Where a failed backup's notice goes: the engine's one publish. */
  readonly publish: PublishPush;
  readonly clock: Clock;
  /** Where the timer adds what stops it. */
  readonly closers: Closers;
  readonly logger: Logger;
}

// The timer looks at the owner's timezone again at least once an hour, so a change of it moves
// the next backup within the hour.
const lookAgainMs = 3_600_000;

async function waitFor(
  options: BackupTimerOptions,
  stop: AbortSignal,
): Promise<ScheduledBackup | undefined> {
  const { clock } = options;
  let zone = options.schedule().timeZone;
  let next = nextBackupAt(clock.now(), zone);
  while (clock.now() < next.atMs) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one wait at a time, until the time comes
    await clock.sleep(Math.min(next.atMs - clock.now(), lookAgainMs), stop).catch(() => undefined);
    if (stop.aborted) {
      return undefined;
    }
    const now = options.schedule().timeZone;
    if (now !== zone) {
      zone = now;
      next = nextBackupAt(clock.now(), zone);
    }
  }
  return next;
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

// One night: the wait until 03:30, then the backup when the switch is on, then the next night.
async function oneNight(
  options: BackupTimerOptions,
  run: { readonly stop: AbortSignal; readonly next: () => void },
): Promise<void> {
  const { stop } = run;
  const due = await waitFor(options, stop);
  if (due === undefined) {
    return;
  }
  if (options.schedule().isOn) {
    const taken = await take(options, due.kind, stop);
    if (!stop.aborted && !taken.ok) {
      options.publish(backupFailedNotice(taken.error));
    }
  }
  if (!stop.aborted) {
    run.next();
  }
}

/**
 * Takes the nightly backup at 03:30 owner time while the engine serves (keys spec, section 7.3),
 * Sunday's as the weekly one, when `backups.daily` is on. It reads the switch and the timezone
 * from the config each time, so a reload applies within the hour. A backup that fails, or whose
 * check fails, raises `notice.backupFailed` with the reason. A locked engine backs up too: a
 * backup needs no key the lock holds. Its closer stops it and waits for a backup under way.
 */
export function startBackupTimer(options: BackupTimerOptions): void {
  const stop = new AbortController();
  const timer = { running: Promise.resolve() };
  // Each night starts the next once it ends, and nothing waits on it, so the nights never chain
  // up however long the engine serves.
  const next = (): void => {
    timer.running = oneNight(options, { stop: stop.signal, next });
  };
  next();
  options.closers.add("backups", async () => {
    stop.abort();
    await timer.running;
  });
}
