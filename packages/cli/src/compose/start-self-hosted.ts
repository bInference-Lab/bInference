import { BinferenceError, createDeadline } from "@binference/core";
import type { EngineStores } from "@binference/engine";
import {
  acquireFileLock,
  createShutdown,
  ensurePrivateFolder,
  type ShutdownReport,
} from "@binference/platform";
import type { EngineState } from "@binference/protocol";
import type { ProtocolServer, ServerAddress } from "@binference/server";
import type { ConfigIssue } from "../config/config-issue.js";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";
import { cliTokenFile, ensureCliToken } from "./cli-token.js";
import { createClosers } from "./closers.js";
import { composeEngine } from "./compose-engine.js";
import { platformOf } from "./engine-locations.js";
import { createEngineOperations } from "./engine-operations.js";
import { startHealthProbe } from "./health-signals.js";
import { createMissingParts } from "./missing-parts.js";
import {
  listenForProtocol,
  type OpenedLog,
  openEngineLog,
  openEngineStores,
  type Opening,
  selfHostedChains,
} from "./open-engine-parts.js";

/** Why the engine did not start, with what the owner needs to fix it. */
export type StartRefusal =
  | { readonly ok: false; readonly refusal: "already_running"; readonly folder: string }
  | {
      readonly ok: false;
      readonly refusal: "config_invalid";
      readonly issues: readonly ConfigIssue[];
    }
  | { readonly ok: false; readonly refusal: "store_damaged"; readonly file: string }
  | { readonly ok: false; readonly refusal: "port_taken"; readonly port: number };

/** A self-hosted engine that serves the protocol until its shutdown sequence ends. */
export interface RunningEngine {
  /** Where the HTTP listener bound: the console, the Mini App and the WebSocket at `/ws`. */
  readonly http: ServerAddress;
  /** The socket path or pipe name the CLI and the agent runtime connect to. */
  readonly ipc: string;
  /** The engine's log file. */
  readonly logFile: string;
  /** Resolves once the shutdown sequence has ended, with what each step did. */
  readonly finished: Promise<ShutdownReport>;
}

/** What one start takes: the host, and the `--set` flags of this run. */
export interface StartOptions {
  readonly host: CliHost;
  readonly sets: readonly string[];
}

/** What the server is built from once the config, the log and the store are open. */
interface Opened {
  readonly config: BinferenceConfig;
  readonly log: OpenedLog;
  readonly stores: EngineStores;
}

/** A running engine, or why it did not start. */
type StartOutcome = { readonly ok: true; readonly engine: RunningEngine } | StartRefusal;

// Opening the store and binding take seconds; past this the start gives up.
const startBudgetMs = 60_000;
const loopback = "127.0.0.1";

/** The engine's server, and the call that `engine/stop` makes once the sequence exists. */
interface Composed {
  readonly server: ProtocolServer;
  readonly stopper: { stop: () => void };
  readonly state: { current: EngineState };
}

function compose(opening: Opening, opened: Opened): Composed {
  const { host, closers } = opening;
  const { config, log, stores } = opened;
  const state: { current: EngineState } = { current: "starting" };
  const parts = createMissingParts();
  const probe = startHealthProbe({ missing: parts.missing, logFailed: log.hasFailed });
  closers.add("health", async () => probe.stop());
  const stopper = { stop: (): void => undefined };
  const { server } = composeEngine(
    { custody: parts.custody, stores, prices: parts.prices },
    {
      chains: selfHostedChains(),
      venues: [],
      simulator: parts.simulator,
      wallets: parts.wallets,
      version: host.version,
      owner: config.owner,
      http: { host: loopback, port: config.engine.port, extraOrigins: config.engine.extraOrigins },
      state: () => state.current,
      handlers: createEngineOperations({
        agents: stores.agents,
        version: host.version,
        state: () => state.current,
        health: () => probe.read(),
        stop: () => stopper.stop(),
      }),
      clock: host.clock,
      random: host.random,
      logger: log.logger,
      executor: parts.executor,
      positions: parts.positions,
      // No agent holds a wallet until the wallet facts adapter exists, so a paper reset has nowhere
      // to place the starting balance yet.
      paperBalances: [],
    },
  );
  return { server, stopper, state };
}

async function serve(opening: Opening, opened: Opened): Promise<StartOutcome> {
  const { host, platform, closers } = opening;
  const { config, log } = opened;
  const { server, stopper, state } = compose(opening, opened);
  const listening = await listenForProtocol(opening, server);
  if (!listening.ok) {
    return listening.error === "port_taken"
      ? { ok: false, refusal: "port_taken", port: config.engine.port }
      : { ok: false, refusal: "already_running", folder: platform.stateFolder.root };
  }
  const shutdown = createShutdown({
    clock: host.clock,
    budgetMs: config.engine.shutdownBudgetMs,
    events: host.signals,
    signals: platform.stopSignals,
  });
  shutdown.add("announce", async () => log.logger.info("engine.stopping"));
  closers.handTo(shutdown);
  const finished = shutdown.finished.then((report) => {
    shutdown.dispose();
    return report;
  });
  stopper.stop = () => void shutdown.stop("request");
  state.current = "ready";
  server.publish({ topic: "engine", kind: "engine/state", data: { state: "ready" } });
  log.logger.info("engine.ready");
  const engine: RunningEngine = {
    ...listening.value,
    logFile: log.file,
    finished,
  };
  return { ok: true, engine };
}

async function openAndServe(opening: Opening, sets: readonly string[]): Promise<StartOutcome> {
  const { host, platform, signal } = opening;
  const loaded = await loadConfig({
    file: platform.stateFolder.configFile,
    env: host.env,
    sets,
    system: systemDefaults(host.env),
    signal,
  });
  if (!loaded.ok) {
    return { ok: false, refusal: "config_invalid", issues: loaded.issues };
  }
  const log = await openEngineLog(opening, loaded.config);
  try {
    return await openStoresAndServe(opening, { config: loaded.config, log });
  } catch (error) {
    // The log closes with the other parts; the fault's code is what `binference logs` shows.
    const errorCode = error instanceof BinferenceError ? error.code : "unexpected";
    log.logger.error("engine.start_failed", { errorCode });
    throw error;
  }
}

async function openStoresAndServe(
  opening: Opening,
  opened: Omit<Opened, "stores">,
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
  return serve(opening, { ...opened, stores });
}

/**
 * Starts a self-hosted engine in this process (the composition root of `binference start`): the
 * engine lock, the config with its secret sources, the log file, `engine.sqlite` on its store
 * workers with its migrations and integrity check, the CLI's token, the engine with the missing
 * parts, and the protocol server on the IPC endpoint and on loopback. Stop signals and
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
