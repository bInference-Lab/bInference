import { homedir } from "node:os";
import { BinferenceError, createDeadline, ok } from "@binference/core";
import { acquireFileLock, ensurePrivateFolder } from "@binference/platform";
import { runtimeSettingsOf } from "../agent-runtime/runtime-settings-of.js";
import { loadConfig } from "../config/load-config.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { ConfigOutcome } from "../config/validate-config.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";
import { openEngineWebPushKey } from "../web-push/web-push-key.js";
import { composeChainReads } from "./chain-reads.js";
import { cliTokenFile, ensureCliToken } from "./cli-token.js";
import { createClosers } from "./closers.js";
import { readSetUpInstall } from "./compose-lock.js";
import { type ConfigCell, createConfigCell } from "./config-cell.js";
import { createConfigReloadLink } from "./config-reload-link.js";
import { openConsoleFiles } from "./console-files.js";
import { platformOf } from "./engine-locations.js";
import { openBot } from "./open-bot.js";
import {
  type Opened,
  type OpenedLog,
  openEngineLog,
  openEngineStores,
  type Opening,
  selfHostedChains,
  selfHostedPoolHooks,
} from "./open-engine-parts.js";
import { readRpcUrls } from "./read-rpc-urls.js";
import { readVenues } from "./read-venues.js";
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
  // A reload reads the same layers again: the file, the variables and this run's flags; a change
  // checks a file's new text in them before it is written.
  const layers = {
    file: platform.stateFolder.configFile,
    env: host.env,
    sets,
    system: systemDefaults(host.env, platform),
  };
  const readConfig = async (reading: AbortSignal): Promise<ConfigOutcome> =>
    loadConfig({ ...layers, signal: reading });
  const readConfigFrom = async (text: string, reading: AbortSignal): Promise<ConfigOutcome> =>
    loadConfig({ ...layers, signal: reading, readFile: async () => Promise.resolve(ok(text)) });
  const loaded = await readConfig(signal);
  if (!loaded.ok) {
    return { ok: false, refusal: "config_invalid", issues: loaded.issues };
  }
  const settings = createConfigCell(loaded.config);
  const log = await openEngineLog(opening, settings);
  try {
    const parts = await readSecretParts(opening, settings, log);
    const consoleFiles = await openConsoleFiles(host.consoleFolder, { logger: log.logger, signal });
    const webPushKey = await openEngineWebPushKey(platform, { logger: log.logger, signal });
    const config = loaded.config;
    const read = { readConfig, readConfigFrom, configReload: createConfigReloadLink() };
    const opened = { config, settings, ...read, log, consoleFiles, webPushKey, ...parts };
    return await openStoresAndServe(opening, opened);
  } catch (error) {
    // The log closes with the other parts; the fault's code is what `binference logs` shows.
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    log.logger.error("engine.start_failed", { errorCode });
    throw error;
  }
}

type SecretParts = Pick<
  Opened,
  "tracers" | "headSockets" | "chains" | "reads" | "venues" | "bot" | "runtime" | "secrets"
>;

// The parts that read config's secret sources: the owner's own RPCs, the venues and the bot.
async function readSecretParts(
  opening: Opening,
  settings: ConfigCell,
  log: OpenedLog,
): Promise<SecretParts> {
  const { host, platform, signal } = opening;
  const config = settings.started;
  const secrets = createSecretReader({
    env: host.env,
    keychain: platform.keychain,
    homeDir: host.homeDir ?? homedir(),
    clock: host.clock,
  });
  const call = { logger: log.logger, signal };
  const tracers = await readRpcUrls({ chains: config.chains, secrets, kind: "tracer" }, call);
  const headSockets = await readRpcUrls({ chains: config.chains, secrets, kind: "ws" }, call);
  const chains = selfHostedChains();
  const { http, clock } = host;
  const current = () => settings.current().chains;
  const reads = composeChainReads({ chains, config: config.chains, current, http, clock });
  const venues = await readVenues({
    ...call,
    venues: config.venues,
    chains: config.chains,
    registry: chains,
    poolHooks: selfHostedPoolHooks(),
    reads,
    secrets,
    http,
    clock,
  });
  const source = config.telegram.botToken;
  const logger = log.logger.child("telegram");
  const bot = await openBot({
    source,
    secrets,
    http: host.http,
    ...(host.download === undefined ? {} : { download: host.download }),
    clock: host.clock,
    logger,
    signal,
  });
  const runtime = await runtimeSettingsOf(config, {
    secrets,
    logger: log.logger.child("runtime"),
    signal,
  });
  return { tracers, headSockets, chains, reads, venues, bot, runtime, secrets };
}

async function openStoresAndServe(
  opening: Opening,
  opened: Omit<Opened, "stores" | "install">,
): Promise<StartOutcome> {
  const { host, platform, signal } = opening;
  const openedStores = await openEngineStores(opening, {
    logger: opened.log.logger,
    config: opened.config,
  });
  const file = platform.stateFolder.engineDatabase;
  if (!openedStores.ok) {
    return openedStores.refusal === "store_damaged"
      ? { ok: false, refusal: "store_damaged", file }
      : { ok: false, refusal: "backup_failed", file, reason: openedStores.reason };
  }
  const { stores } = openedStores;
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
 * Starts a self-hosted engine in this process (the composition root of `binference start
 * --foreground`, which the background service runs), in the startup order of ARCHITECTURE.md
 * section 24: the engine lock on the state folder, so a second engine on it refuses at once; the
 * config with its secret sources; the log file; `engine.sqlite` on its store workers with its
 * migrations and integrity check; the CLI's token; then {@link serveEngine}. Stop signals and
 * `engine/stop` start the shutdown sequence, which closes the parts in the reverse order. A start
 * that fails part way closes what it opened.
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
