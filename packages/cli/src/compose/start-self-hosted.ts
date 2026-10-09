import { homedir } from "node:os";
import type { ChainRef, ChainRegistry } from "@binference/chain";
import { BinferenceError, createDeadline } from "@binference/core";
import { type EnginePush, type EngineStores, lockedNotice } from "@binference/engine";
import {
  acquireFileLock,
  createShutdown,
  ensurePrivateFolder,
  type ShutdownReport,
} from "@binference/platform";
import type { EngineState } from "@binference/protocol";
import type { OperationHandlers, ProtocolServer, ServerAddress } from "@binference/server";
import type { ConfigIssue } from "../config/config-issue.js";
import { loadConfig } from "../config/load-config.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CliHost } from "../program/cli-host.js";
import { systemDefaults } from "../program/system-defaults.js";
import type { LockReason } from "../unlock/unlock-keys.js";
import { cliTokenFile, ensureCliToken } from "./cli-token.js";
import { createClosers } from "./closers.js";
import { composeEngine } from "./compose-engine.js";
import { composeExecutor } from "./compose-executor.js";
import {
  type ComposedLock,
  composeLock,
  readSetUpInstall,
  type SetUpInstall,
} from "./compose-lock.js";
import { platformOf } from "./engine-locations.js";
import { createEngineOperations } from "./engine-operations.js";
import { type HealthSignal, startHealthProbe } from "./health-signals.js";
import { createMissingParts, type MissingParts } from "./missing-parts.js";
import {
  listenForProtocol,
  type OpenedLog,
  openEngineLog,
  openEngineStores,
  type Opening,
  selfHostedChains,
} from "./open-engine-parts.js";
import { readTracers } from "./read-tracers.js";

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
  /** `ready`, or `locked` when the unlock mode did not open the agent key (decision 0103). */
  readonly state: EngineState;
  /** Why the engine is locked, when it is. */
  readonly lockReason?: LockReason;
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
  /** The install, or `undefined` before `binference init` set it up. */
  readonly install: SetUpInstall | undefined;
  /** The owner's tracing RPC of each chain config names one for, read from its secret. */
  readonly tracers: ReadonlyMap<ChainRef, string>;
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
  readonly locked: ComposedLock;
}

// The executor sends through the chains' relays; its pushes reach the engine's once it exists.
function composeSending(
  opening: Opening,
  opened: Opened,
  context: { readonly parts: MissingParts; readonly chains: ChainRegistry },
) {
  const { host, closers } = opening;
  const { config, log, stores } = opened;
  const { parts, chains } = context;
  const pushes = { publish: (_push: EnginePush): void => undefined };
  const composed = composeExecutor({
    stores,
    tracers: opened.tracers,
    positions: parts.positions,
    custody: parts.custody,
    wallets: parts.wallets,
    prices: parts.prices,
    chains,
    config: config.chains,
    http: host.http,
    clock: host.clock,
    random: host.random,
    publish: (push) => {
      pushes.publish(push);
    },
    logger: log.logger,
  });
  closers.add("executor", async () => composed.executor.close());
  return { ...composed, pushes };
}

/** What the engine's own operations answer from besides the stores. */
interface EngineWiring extends Pick<Composed, "stopper" | "locked"> {
  readonly missing: MissingParts["missing"];
  /** The executor's health signal. */
  readonly executor: () => HealthSignal["state"];
}

// The engine's own operations: its status with the health signals, its stop and its unlock.
function engineHandlers(opening: Opening, opened: Opened, wiring: EngineWiring): OperationHandlers {
  const probe = startHealthProbe({
    missing: wiring.missing,
    parts: [{ signal: "executor", state: wiring.executor }],
    logFailed: opened.log.hasFailed,
  });
  opening.closers.add("health", async () => probe.stop());
  return createEngineOperations({
    agents: opened.stores.agents,
    version: opening.host.version,
    state: wiring.locked.state,
    lock: wiring.locked.lock,
    health: () => probe.read(),
    stop: () => wiring.stopper.stop(),
  });
}

function compose(opening: Opening, opened: Opened): Composed {
  const { host, platform } = opening;
  const { config, log, stores } = opened;
  const state: { current: EngineState } = { current: "starting" };
  const parts = createMissingParts();
  const chains = selfHostedChains();
  const sending = composeSending(opening, opened, { parts, chains });
  const locked = composeLock({ host, platform, config, install: opened.install, started: state });
  const stopper = { stop: (): void => undefined };
  const { server, publish } = composeEngine(
    { custody: parts.custody, stores, prices: parts.prices },
    {
      chains,
      venues: [],
      simulator: parts.simulator,
      wallets: parts.wallets,
      version: host.version,
      owner: config.owner,
      http: { host: loopback, port: config.engine.port, extraOrigins: config.engine.extraOrigins },
      state: locked.state,
      isLocked: () => locked.lock.isLocked(),
      handlers: engineHandlers(opening, opened, {
        missing: parts.missing,
        executor: sending.health,
        stopper,
        locked,
      }),
      clock: host.clock,
      random: host.random,
      logger: log.logger,
      executor: sending.executor,
      positions: parts.positions,
      // No agent holds a wallet until the wallet facts adapter exists, so a paper reset has nowhere
      // to place the starting balance yet.
      paperBalances: [],
    },
  );
  sending.pushes.publish = publish;
  locked.announce.publish = publish;
  return { server, stopper, state, locked };
}

async function serve(opening: Opening, opened: Opened): Promise<StartOutcome> {
  const { host, platform, closers } = opening;
  const { config, log } = opened;
  const { server, stopper, state, locked } = compose(opening, opened);
  const unlocked = await locked.lock.unlock({ signal: opening.signal });
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
  server.publish({ topic: "engine", kind: "engine/state", data: { state: locked.state() } });
  log.logger.info("engine.ready");
  if (!unlocked.ok) {
    log.logger.warn("engine.locked", { errorCode: `unlock.${unlocked.error}` });
    server.publish(lockedNotice());
  }
  const engine: RunningEngine = {
    ...listening.value,
    logFile: log.file,
    state: locked.state(),
    ...(unlocked.ok ? {} : { lockReason: unlocked.error }),
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
  return serve(opening, { ...opened, stores, install });
}

/**
 * Starts a self-hosted engine in this process (the composition root of `binference start`): the
 * engine lock, the config with its secret sources, the log file, `engine.sqlite` on its store
 * workers with its migrations and integrity check, the CLI's token, the agent key through the
 * unlock mode, the engine with the missing parts, and the protocol server on the IPC endpoint and
 * on loopback. An install whose key does not open runs locked, with the reason and the
 * `notice.locked` notice (decision 0103), until `engine/unlock` opens it. Stop signals and
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
