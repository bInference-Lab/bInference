import { homedir } from "node:os";
import { BinferenceError, createDeadline } from "@binference/core";
import { acquireFileLock, ensurePrivateFolder } from "@binference/platform";
import { loadConfig } from "../config/load-config.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";
import { cliTokenFile, ensureCliToken } from "./cli-token.js";
import { createClosers } from "./closers.js";
import { readSetUpInstall } from "./compose-lock.js";
import { platformOf } from "./engine-locations.js";
import { type Opened, openEngineLog, openEngineStores, type Opening } from "./open-engine-parts.js";
import { readTracers } from "./read-tracers.js";
import { serveEngine } from "./serve-engine.js";
import type { StartOutcome } from "./start-outcome.js";

/** What one start takes: the host, and the `--set` flags of this run. */
export interface StartOptions {
  readonly host: CliHost;
  readonly sets: readonly string[];
}

// Opening the store and binding take seconds; past this the start gives up.
const startBudgetMs = 60_000;

async function openAndServe(opening: Opening, sets: readonly string[]): Promise<StartOutcome> {
  const { host, platform, signal } = opening;
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets,
    system: systemDefaults(host.env, platform),
    signal,
  });
  if (!loaded.ok) {
    return { ok: false, refusal: "config_invalid", issues: loaded.issues };
  }
  const log = await openEngineLog(opening, loaded.config);
  try {
    const secrets = createSecretReader({
      env: host.env,
      keychain: platform.keychain,
      homeDir: host.homeDir ?? homedir(),
      clock: host.clock,
    });
    const call = { logger: log.logger, signal };
    const tracers = await readTracers(loaded.config.chains, secrets, call);
    return await openStoresAndServe(opening, { config: loaded.config, log, tracers });
  } catch (error) {
    // The log closes with the other parts; the fault's code is what `binference logs` shows.
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    log.logger.error("engine.start_failed", { errorCode });
    throw error;
  }
}

async function openStoresAndServe(
  opening: Opening,
  opened: Omit<Opened, "stores" | "install">,
): Promise<StartOutcome> {
  const { host, platform, signal } = opening;
  const stores = await openEngineStores(opening, opened.log.logger);
  if (stores === undefined) {
    return { ok: false, refusal: "store_damaged", file: platform.stateFolder.engineDatabase };
  }
  await ensureCliToken({
    access: stores.access,
    file: cliTokenFile(platform.stateFolder),
    permissions: platform.permissions,
    clock: host.clock,
    random: host.random,
    signal,
  });
  const install = await readSetUpInstall(stores, { host, signal });
  return serveEngine(opening, { ...opened, stores, install });
}

/**
 * Starts a self-hosted engine in this process (the composition root of `binference start`), in
 * the startup order of ARCHITECTURE.md section 24: the engine lock on the state folder, so a
 * second engine on it refuses at once; the config with its secret sources; the log file;
 * `engine.sqlite` on its store workers with its migrations and integrity check; the CLI's token;
 * then {@link serveEngine}. Stop signals and `engine/stop` start the shutdown sequence, which
 * closes the parts in the reverse order. A start that fails part way closes what it opened.
 */
export async function startSelfHosted(options: StartOptions): Promise<StartOutcome> {
  const { host } = options;
  const platform = platformOf(host);
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: startBudgetMs,
  });
  const { signal } = deadline;
  await ensurePrivateFolder(platform.stateFolder.root, {
    permissions: platform.permissions,
    signal,
  });
  const lock = acquireFileLock(platform.stateFolder.engineLock);
  if (!lock.ok) {
    deadline.clear();
    return { ok: false, refusal: "already_running", folder: platform.stateFolder.root };
  }
  const closers = createClosers();
  closers.add("lock", async () => lock.value.release());
  try {
    const started = await openAndServe({ host, platform, closers, signal }, options.sets);
    if (!started.ok) {
      await closers.closeAll(signal);
    }
    return started;
  } catch (error) {
    await closers.closeAll(signal);
    throw error;
  } finally {
    deadline.clear();
  }
}
