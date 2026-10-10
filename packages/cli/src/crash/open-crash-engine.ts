import { BinferenceError } from "@binference/core";
import { acquireFileLock, ensurePrivateFolder } from "@binference/platform";
import { type Closers, createClosers } from "../compose/closers.js";
import { createConfigCell } from "../compose/config-cell.js";
import { platformOf } from "../compose/engine-locations.js";
import {
  openEngineLog,
  openEngineStores,
  type OpenedStores,
} from "../compose/open-engine-parts.js";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { EngineLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";

/** The crash engine's parts that `binference start` opens first, and their closers. */
export interface CrashOpened {
  readonly host: CliHost;
  readonly config: BinferenceConfig;
  readonly stores: OpenedStores;
  readonly logger: EngineLogger;
  /** Closes what was opened, last opened first. */
  readonly closers: Closers;
}

function refusal(code: `crash.${string}`, message: string): BinferenceError {
  return new BinferenceError({ code, message });
}

async function openInOrder(host: CliHost, closers: Closers, signal: AbortSignal) {
  const platform = platformOf(host);
  const { stateFolder, permissions } = platform;
  await ensurePrivateFolder(stateFolder.root, { permissions, signal });
  const lock = acquireFileLock(stateFolder.engineLock);
  if (!lock.ok) {
    throw refusal("crash.already_running", "Another engine holds the state folder.");
  }
  closers.add("lock", async () => lock.value.release());
  const loaded = await loadConfig({
    file: stateFolder.configFile,
    env: host.env,
    sets: [],
    system: systemDefaults(host.env, platform),
    signal,
  });
  if (!loaded.ok) {
    throw refusal("crash.config_invalid", "The crash engine's config.json5 does not load.");
  }
  const opening = { host, platform, closers, signal };
  const log = await openEngineLog(opening, createConfigCell(loaded.config));
  const stores = await openEngineStores(opening, log.logger);
  if (stores === undefined) {
    throw refusal("crash.store_damaged", "engine.sqlite failed its integrity check.");
  }
  return { host, config: loaded.config, stores, logger: log.logger, closers };
}

/**
 * Opens the crash engine's state folder as `binference start` does, in its order: the engine
 * lock, so a run never shares the folder with the engine it killed; `config.json5`; the engine
 * log; and `engine.sqlite` on its store workers with its migrations and integrity check. A start
 * that fails part way closes what it opened.
 */
export async function openCrashEngine(host: CliHost, signal: AbortSignal): Promise<CrashOpened> {
  const closers = createClosers();
  try {
    return await openInOrder(host, closers, signal);
  } catch (error) {
    await closers.closeAll(signal);
    throw error;
  }
}
