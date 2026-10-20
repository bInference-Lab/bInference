import type { Logger } from "@binference/core";
import type { BackupFailure, BackupRecord } from "@binference/engine/backups";
import { acquireFileLock, ensurePrivateFolder, fileSize, openLogFile } from "@binference/platform";
import {
  type AgentStateCleared,
  agentWorker,
  createAgentStateReset,
  createEngineStateReset,
  createSqliteBackupStore,
  createSqliteConfigJournal,
  createSqliteInstallStore,
  type DatabaseHandle,
  type EngineStateCleared,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { takeBackup } from "../backups/take-backup.js";
import { backupRunOf } from "../compose/compose-backups.js";
import { engineLogFile, platformOf } from "../compose/engine-locations.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createFileLogger, type EngineLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";
import { liveTradeStored } from "../state/live-trade.js";

/** How a reset of the local state ended. */
export type ResetOutcome =
  | {
      readonly kind: "reset";
      readonly backup: BackupRecord;
      readonly cleared: EngineStateCleared & AgentStateCleared;
    }
  /** An engine holds the state folder. */
  | { readonly kind: "locked" }
  /** A live trade is on its way; nothing changed. */
  | { readonly kind: "sending" }
  /** `engine.sqlite` is missing, does not open, or has another schema than this binference. */
  | { readonly kind: "unreadable" }
  /** The backup that comes first failed; nothing was cleared. */
  | { readonly kind: "backup_failed"; readonly failure: BackupFailure };

/** What one reset runs with: the host, the config it loaded, and the reset's deadline. */
export interface ResetRun {
  readonly host: CliHost;
  readonly config: BinferenceConfig;
  readonly signal: AbortSignal;
}

const noAgentChats: AgentStateCleared = { sessions: 0, turns: 0, events: 0, queued: 0, notes: 0 };
const mebibyte = 1024 * 1024;
const dayMs = 86_400_000;

// The engine log, so the reset's backup and its end are in it beside the engine's own lines.
async function openResetLog(run: ResetRun): Promise<EngineLogger> {
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

// A database of this binference's schema, or `undefined` when it is missing or another schema.
async function openCurrent(
  run: ResetRun,
  file: string,
  worker: URL,
): Promise<DatabaseHandle | undefined> {
  if (!(await fileSize(file, run.signal)).ok) {
    return undefined;
  }
  const database = await openDatabase({
    file,
    worker,
    readers: 0,
    execArgv: run.host.workerExecArgv ?? [],
    signal: run.signal,
  });
  if (database.schemaVersion === database.latestVersion) {
    return database;
  }
  await database.close();
  return undefined;
}

// Takes the sealed backup, then clears both databases and journals what went.
async function backUpAndClear(
  run: ResetRun,
  databases: { readonly engine: DatabaseHandle; readonly agent: DatabaseHandle | undefined },
  logger: Logger,
): Promise<ResetOutcome> {
  const { host, config, signal } = run;
  const { engine, agent } = databases;
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
  const backupRun = backupRunOf(
    config,
    { kind: "manual", engineSchemaVersion: engine.schemaVersion },
    signal,
  );
  const backup = await takeBackup(parts, backupRun);
  if (!backup.ok) {
    return { kind: "backup_failed", failure: backup.error };
  }
  const chats =
    agent === undefined ? noAgentChats : await createAgentStateReset(agent).clear({ signal });
  const cleared = { ...(await createEngineStateReset(engine).clear({ signal })), ...chats };
  const after = { backup: backup.value.id, ...cleared };
  const change = { atMs: host.clock.now(), by: "cli", surface: "cli", path: "state.reset", after };
  await createSqliteConfigJournal(engine).record(change, { signal });
  logger.info("state.reset");
  return { kind: "reset", backup: backup.value, cleared };
}

async function clearOpened(run: ResetRun, logger: Logger): Promise<ResetOutcome> {
  const { stateFolder } = platformOf(run.host);
  const engine = await openCurrent(run, stateFolder.engineDatabase, engineWorker);
  if (engine === undefined) {
    return { kind: "unreadable" };
  }
  const agent = await openCurrent(run, stateFolder.agentDatabase, agentWorker).catch(
    () => undefined,
  );
  try {
    return await backUpAndClear(run, { engine, agent }, logger);
  } finally {
    await agent?.close();
    await engine.close();
  }
}

/**
 * Resets the local state with the engine stopped, under the engine lock (decision 0265): refuses
 * while a live trade is on its way, then takes a `manual` backup sealed to the owner key and, only
 * once it is checked, clears the chats, notes, agent inbox, questions and risk cache, and records
 * the reset in the config journal. Wallets, the custody link, keys, the config, limits, saved
 * addresses, orders, schedules and every money record stay.
 */
export async function clearLocalState(run: ResetRun): Promise<ResetOutcome> {
  const lock = acquireFileLock(platformOf(run.host).stateFolder.engineLock);
  if (!lock.ok) {
    return { kind: "locked" };
  }
  try {
    const trade = await liveTradeStored(run.host, run.signal);
    if (trade !== "none") {
      return { kind: trade };
    }
    const logger = await openResetLog(run);
    try {
      return await clearOpened(run, logger);
    } finally {
      await logger.close();
    }
  } finally {
    lock.value.release();
  }
}
