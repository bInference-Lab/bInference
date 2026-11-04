import type { Logger, Result } from "@binference/core";
import type { BackupFailure, BackupKind, BackupRecord } from "@binference/engine/backups";
import { ensurePrivateFolder, fileSize, openLogFile } from "@binference/platform";
import {
  createSqliteBackupStore,
  createSqliteInstallStore,
  type DatabaseHandle,
  openDatabase,
} from "@binference/store";
import { takeBackup } from "../backups/take-backup.js";
import { backupRunOf } from "../compose/compose-backups.js";
import { engineLogFile, platformOf } from "../compose/engine-locations.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createFileLogger, type EngineLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";

/** A command's work on the stopped engine's state folder: the host, its config and a deadline. */
export interface StoppedStateRun {
  readonly host: CliHost;
  readonly config: BinferenceConfig;
  readonly signal: AbortSignal;
}

const mebibyte = 1024 * 1024;
const dayMs = 86_400_000;

/**
 * The engine log, opened by a command that works on the stopped engine's state, so what it does
 * is in it beside the engine's own lines.
 */
export async function openStateLog(run: StoppedStateRun): Promise<EngineLogger> {
  const { host, config, signal } = run;
  const platform = platformOf(host);
  await ensurePrivateFolder(platform.stateFolder.logs, {
    permissions: platform.permissions,
    signal,
  });
  const file = openLogFile({
    file: engineLogFile(platform),
    maxBytes: () => config.logging.maxFileMb * mebibyte,
    keepMs: () => config.logging.keepDays * dayMs,
    clock: host.clock,
    onError: () => undefined,
  });
  return createFileLogger({
    file,
    level: () => config.logging.level,
    clock: host.clock,
    subsystem: "cli",
  });
}

/**
 * A database of the stopped engine, whatever its schema, or `undefined` when the file is missing.
 * The caller closes it.
 */
async function openStoppedDatabase(
  run: StoppedStateRun,
  file: string,
  worker: URL,
): Promise<DatabaseHandle | undefined> {
  if (!(await fileSize(file, run.signal)).ok) {
    return undefined;
  }
  return openDatabase({
    file,
    worker,
    readers: 0,
    execArgv: run.host.workerExecArgv ?? [],
    signal: run.signal,
  });
}

/**
 * A database of this binference's schema, or `undefined` when it is missing or another schema.
 * The caller closes it.
 */
export async function openCurrentDatabase(
  run: StoppedStateRun,
  file: string,
  worker: URL,
): Promise<DatabaseHandle | undefined> {
  const database = await openStoppedDatabase(run, file, worker);
  if (database === undefined || database.schemaVersion === database.latestVersion) {
    return database;
  }
  await database.close();
  return undefined;
}

/**
 * Takes a backup of the stopped engine's state, sealed to the owner key and read back (keys spec,
 * section 7), of the kind given, through the open `engine.sqlite`.
 */
export async function backUpStoppedState(
  run: StoppedStateRun,
  backup: { readonly engine: DatabaseHandle; readonly kind: BackupKind },
  logger: Logger,
): Promise<Result<BackupRecord, BackupFailure>> {
  const { host, config, signal } = run;
  const { engine } = backup;
  const platform = platformOf(host);
  const parts = {
    stateFolder: platform.stateFolder,
    engineDatabase: engine,
    install: createSqliteInstallStore(engine),
    backups: createSqliteBackupStore(engine),
    permissions: platform.permissions,
    clock: host.clock,
    random: host.random,
    logger: logger.child("backups"),
    binferenceVersion: host.version,
    workerExecArgv: host.workerExecArgv ?? [],
  };
  const kind = { kind: backup.kind, engineSchemaVersion: engine.schemaVersion };
  return takeBackup(parts, backupRunOf(config, kind, signal));
}
