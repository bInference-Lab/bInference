import type { Result } from "@binference/core";
import type { BackupFailure, BackupRecord } from "@binference/engine/backups";
import { acquireFileLock } from "@binference/platform";
import { type DatabaseHandle, engineWorker } from "@binference/store";
import { platformOf } from "../compose/engine-locations.js";
import { liveTradeStored } from "../state/live-trade.js";
import {
  backUpStoppedState,
  openCurrentDatabase,
  openStateLog,
  type StoppedStateRun,
} from "../state/stopped-state.js";
import { copyKeptState, type KeptFilesRun, restoreKeptState } from "./kept-files.js";
import { writeUpdateState } from "./update-state.js";

/** How holding the stopped state for an update went. */
export type HoldOutcome =
  | { readonly kind: "held"; readonly backup: BackupRecord }
  /** An engine holds the state folder. */
  | { readonly kind: "locked" }
  /** A live trade is on its way. */
  | { readonly kind: "sending" }
  /** `engine.sqlite` is missing, does not open, or has another schema than this binference. */
  | { readonly kind: "unreadable" }
  | { readonly kind: "backup_failed"; readonly failure: BackupFailure };

/** How putting the copied state back under the engine lock went. */
export type PutBack = "restored" | "missing" | "changed" | "locked";

/** The kept files' run on the stopped state folder of the host. */
export function keptRunOf(run: Pick<StoppedStateRun, "host" | "signal">): KeptFilesRun {
  const platform = platformOf(run.host);
  return {
    stateFolder: platform.stateFolder,
    permissions: platform.permissions,
    signal: run.signal,
  };
}

// The sealed `before_update` backup, through the open engine database, which it closes.
async function backUpClosing(
  run: StoppedStateRun,
  engine: DatabaseHandle,
): Promise<Result<BackupRecord, BackupFailure>> {
  const logger = await openStateLog(run);
  try {
    return await backUpStoppedState(run, { engine, kind: "before_update" }, logger);
  } finally {
    await engine.close();
    await logger.close();
  }
}

// The sealed backup, then the copies, then the record that holds every engine locked.
async function backUpAndCopy(
  run: StoppedStateRun,
  versions: { readonly from: string; readonly to: string },
): Promise<HoldOutcome> {
  const { stateFolder } = platformOf(run.host);
  const engine = await openCurrentDatabase(run, stateFolder.engineDatabase, engineWorker);
  if (engine === undefined) {
    return { kind: "unreadable" };
  }
  const backup = await backUpClosing(run, engine);
  if (!backup.ok) {
    return { kind: "backup_failed", failure: backup.error };
  }
  // The engine database is closed now: its copy is the file as the stopped engine left it.
  const kept = keptRunOf(run);
  await copyKeptState(kept);
  const checking = { state: "checking", ...versions, backup: backup.value.id } as const;
  await writeUpdateState(stateFolder.root, checking, kept);
  return { kind: "held", backup: backup.value };
}

/**
 * Readies the stopped state for an update, under the engine lock (decision 0356): refuses while a
 * live trade is on its way, takes a `before_update` backup sealed to the owner key, copies the
 * closed databases and `config.json5` owner-only into `updates/rollback/`, and records the update
 * as `checking`, so every engine starts locked until it ends.
 */
export async function holdForUpdate(
  run: StoppedStateRun,
  versions: { readonly from: string; readonly to: string },
): Promise<HoldOutcome> {
  const lock = acquireFileLock(platformOf(run.host).stateFolder.engineLock);
  if (!lock.ok) {
    return { kind: "locked" };
  }
  try {
    const trade = await liveTradeStored(run.host, run.signal);
    return trade === "none" ? await backUpAndCopy(run, versions) : { kind: trade };
  } finally {
    lock.value.release();
  }
}

/**
 * Puts the copied state back as plain files under the engine lock, whatever the new version did to
 * it (decision 0356): never through a database, which an older build refuses once a newer one
 * migrated it. Answers `locked` while an engine holds the folder, and then changes nothing.
 */
export async function putStateBack(run: KeptFilesRun): Promise<PutBack> {
  const lock = acquireFileLock(run.stateFolder.engineLock);
  if (!lock.ok) {
    return "locked";
  }
  try {
    return await restoreKeptState(run);
  } finally {
    lock.value.release();
  }
}
