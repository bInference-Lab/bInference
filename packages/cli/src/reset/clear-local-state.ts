import type { Logger } from "@binference/core";
import type { BackupFailure, BackupRecord } from "@binference/engine/backups";
import { acquireFileLock } from "@binference/platform";
import {
  type AgentStateCleared,
  agentWorker,
  createAgentStateReset,
  createEngineStateReset,
  createSqliteConfigJournal,
  type DatabaseHandle,
  type EngineStateCleared,
  engineWorker,
} from "@binference/store";
import { platformOf } from "../compose/engine-locations.js";
import { liveTradeStored } from "../state/live-trade.js";
import {
  backUpStoppedState,
  openCurrentDatabase,
  openStateLog,
  type StoppedStateRun,
} from "../state/stopped-state.js";

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
export type ResetRun = StoppedStateRun;

const noAgentChats: AgentStateCleared = { sessions: 0, turns: 0, events: 0, queued: 0, notes: 0 };

// Takes the sealed backup, then clears both databases and journals what went.
async function backUpAndClear(
  run: ResetRun,
  databases: { readonly engine: DatabaseHandle; readonly agent: DatabaseHandle | undefined },
  logger: Logger,
): Promise<ResetOutcome> {
  const { host, signal } = run;
  const { engine, agent } = databases;
  const backup = await backUpStoppedState(run, { engine, kind: "manual" }, logger);
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
  const engine = await openCurrentDatabase(run, stateFolder.engineDatabase, engineWorker);
  if (engine === undefined) {
    return { kind: "unreadable" };
  }
  const agent = await openCurrentDatabase(run, stateFolder.agentDatabase, agentWorker).catch(
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
    const logger = await openStateLog(run);
    try {
      return await clearOpened(run, logger);
    } finally {
      await logger.close();
    }
  } finally {
    lock.value.release();
  }
}
