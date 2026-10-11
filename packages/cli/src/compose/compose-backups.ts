import { err, ok, type Result } from "@binference/core";
import type { PublishPush } from "@binference/engine";
import type { BackupFailure, BackupKind, BackupStore } from "@binference/engine/backups";
import type { InstallStore } from "@binference/engine/install";
import type { BackupParts } from "../backups/backup-parts.js";
import { isNightMissed } from "../backups/backup-schedule.js";
import { type BackupRun, takeBackup } from "../backups/take-backup.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { startBackupTimer } from "./backup-timer.js";
import type { ConfigCell } from "./config-cell.js";
import type { Opening } from "./open-engine-parts.js";

/** What backups of one engine are taken from: its database, install and backup records. */
export interface BackupSources {
  readonly database: BackupParts["engineDatabase"];
  readonly install: Pick<InstallStore, "installId" | "read">;
  readonly backups: BackupStore;
}

// Keys spec, section 7.3: the last 3 backups taken before updates and migrations stay.
const keptBeforeChanges = 3;

/** The parts every backup of this engine takes, from what the start opened. */
export function backupPartsOf(
  opening: Opening,
  sources: BackupSources,
  logger: BackupParts["logger"],
): BackupParts {
  const { host, platform } = opening;
  return {
    stateFolder: platform.stateFolder,
    engineDatabase: sources.database,
    install: sources.install,
    backups: sources.backups,
    permissions: platform.permissions,
    clock: host.clock,
    random: host.random,
    logger: logger.child("backups"),
    binferenceVersion: host.version,
    workerExecArgv: host.workerExecArgv ?? [],
  };
}

/** One backup of a kind, with the `backups` settings the config holds now. */
function backupRunOf(
  config: BinferenceConfig,
  backup: { readonly kind: BackupKind; readonly engineSchemaVersion: number },
  signal: AbortSignal,
): BackupRun {
  const { copyTo, keepDaily, keepWeekly } = config.backups;
  return {
    ...backup,
    configVersion: config.version,
    ...(copyTo === undefined ? {} : { copyTo }),
    kept: { daily: keepDaily, weekly: keepWeekly, beforeChanges: keptBeforeChanges },
    signal,
  };
}

/**
 * Takes the backup that comes before a migration (keys spec, section 7.3), once `engine.sqlite` is
 * open and before `migrate` runs: only for a database a migration will change, one with a schema
 * older than this build's. An install that holds no owner key yet has nothing a backup could seal,
 * so its migration goes on. Any other failure stops the migration: it never runs without its
 * backup.
 */
export async function backUpBeforeMigration(
  parts: BackupParts,
  config: BinferenceConfig,
  signal: AbortSignal,
): Promise<Result<void, BackupFailure>> {
  const { schemaVersion, latestVersion } = parts.engineDatabase;
  if (schemaVersion === 0 || schemaVersion >= latestVersion) {
    return ok(undefined);
  }
  const run = backupRunOf(
    config,
    { kind: "before_migration", engineSchemaVersion: schemaVersion },
    signal,
  );
  const taken = await takeBackup(parts, run);
  return taken.ok || taken.error === "no_owner_key" || taken.error === "copy"
    ? ok(undefined)
    : err(taken.error);
}

/**
 * Whether a night's backup was missed (keys spec, section 7.3), from the backups `engine.sqlite`
 * records and when the install was attached to this machine. An install with no owner key yet
 * has nothing a backup could seal, so it misses none.
 */
export async function missedNight(parts: BackupParts, signal: AbortSignal): Promise<boolean> {
  const { custody } = await parts.install.read({ signal });
  if (custody === undefined) {
    return false;
  }
  const nightly = (await parts.backups.list({ signal }))
    .filter((backup) => backup.kind === "daily" || backup.kind === "weekly")
    .filter((backup) => backup.verifiedAtMs !== undefined)
    .map((backup) => backup.createdAtMs);
  const { attachedAtMs } = custody;
  return isNightMissed(
    parts.clock.now(),
    nightly.length === 0 ? { attachedAtMs } : { attachedAtMs, newestMs: Math.max(...nightly) },
  );
}

/**
 * Starts the nightly backup of a serving engine, reading `backups` and `owner.timezone` from the
 * config cell each time, so a reload of `config.json5` applies to the next one.
 */
export function startNightlyBackups(
  opening: Opening,
  backup: {
    readonly parts: BackupParts;
    readonly settings: ConfigCell;
    readonly publish: PublishPush;
  },
): void {
  const { parts, settings } = backup;
  startBackupTimer({
    takeBackup: async (kind, signal) =>
      takeBackup(
        parts,
        backupRunOf(
          settings.current(),
          { kind, engineSchemaVersion: parts.engineDatabase.latestVersion },
          signal,
        ),
      ),
    isNightMissed: async (signal) => missedNight(parts, signal),
    schedule: () => ({
      isOn: settings.current().backups.daily,
      timeZone: settings.current().owner.timezone,
    }),
    publish: backup.publish,
    clock: opening.host.clock,
    closers: opening.closers,
    logger: parts.logger,
  });
}
