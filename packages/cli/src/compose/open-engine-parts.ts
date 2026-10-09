import { type ChainRef, type ChainRegistry, createChainRegistry } from "@binference/chain";
import { createEvmFamily, createEvmSigningScheme } from "@binference/chain-evm";
import { bsc } from "@binference/chains";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { EngineStores, RiskCacheStore } from "@binference/engine";
import { ensurePrivateFolder, openLogFile, type Platform } from "@binference/platform";
import type { ProtocolServer, ServerAddress } from "@binference/server";
import {
  createSqliteEngineStores,
  createSqliteRiskCacheStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createFileLogger, type EngineLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";
import type { Closers } from "./closers.js";
import type { SetUpInstall } from "./compose-lock.js";
import { engineEndpoint, engineLogFile } from "./engine-locations.js";

/** One start while its parts open: each part adds what closes it. */
export interface Opening {
  readonly host: CliHost;
  readonly platform: Platform;
  readonly closers: Closers;
  /** The start's deadline. */
  readonly signal: AbortSignal;
}

/** What the engine is built from once the config, the log and the store are open. */
export interface Opened {
  readonly config: BinferenceConfig;
  readonly log: OpenedLog;
  readonly stores: OpenedStores;
  /** The install, or `undefined` before `binference init` set it up. */
  readonly install: SetUpInstall | undefined;
  /** The owner's tracing RPC of each chain config names one for, read from its secret. */
  readonly tracers: ReadonlyMap<ChainRef, string>;
}

/** The engine's logger, its file, and whether the file lost lines. */
export interface OpenedLog {
  readonly logger: EngineLogger;
  readonly file: string;
  readonly hasFailed: () => boolean;
}

/** Where the engine listens. */
export interface Listening {
  readonly http: ServerAddress;
  /** The socket path or pipe name. */
  readonly ipc: string;
}

const mebibyte = 1024 * 1024;
const dayMs = 86_400_000;

/** Opens `logs/engine.log` with the config's size and age limits, and the logger on it. */
export async function openEngineLog(
  opening: Opening,
  config: BinferenceConfig,
): Promise<OpenedLog> {
  const { platform, host } = opening;
  await ensurePrivateFolder(platform.stateFolder.logs, {
    permissions: platform.permissions,
    signal: opening.signal,
  });
  const state = { failed: false };
  const file = engineLogFile(platform);
  const logFile = openLogFile({
    file,
    maxBytes: config.logging.maxFileMb * mebibyte,
    keepMs: config.logging.keepDays * dayMs,
    clock: host.clock,
    onError: () => {
      state.failed = true;
    },
  });
  const logger = createFileLogger({
    file: logFile,
    level: config.logging.level,
    clock: host.clock,
    subsystem: "engine",
  });
  opening.closers.add("logs", async () => logger.close());
  return { logger, file, hasFailed: () => state.failed };
}

/** The store ports on `engine.sqlite`: the engine's, and the risk step's cache. */
export interface OpenedStores extends EngineStores {
  readonly riskCache: RiskCacheStore;
}

/**
 * Opens `engine.sqlite` on its store workers, applies its migrations and checks its integrity.
 * Answers the store ports, or `undefined` when the integrity check fails.
 */
export async function openEngineStores(
  opening: Opening,
  logger: EngineLogger,
): Promise<OpenedStores | undefined> {
  const database = await openDatabase({
    file: opening.platform.stateFolder.engineDatabase,
    worker: engineWorker,
    execArgv: opening.host.workerExecArgv ?? [],
    signal: opening.signal,
  });
  opening.closers.add("store", async () => database.close());
  await database.migrate({ signal: opening.signal });
  logger.info("store.migrated");
  const integrity = await database.checkIntegrity({ signal: opening.signal });
  if (!integrity.ok) {
    logger.error("store.integrity_failed");
    return undefined;
  }
  return {
    ...createSqliteEngineStores(database),
    riskCache: createSqliteRiskCacheStore(database),
  };
}

/** The chains this binference serves: BSC on the EVM family. */
export function selfHostedChains(): ChainRegistry {
  return createChainRegistry({
    chains: [bsc],
    families: [createEvmFamily()],
    signingSchemes: [createEvmSigningScheme()],
  });
}

/**
 * Listens for the protocol: first on the engine's IPC endpoint, then on the HTTP listener.
 * Answers `ipc_in_use` while another engine holds the endpoint and `port_taken` when the port is.
 */
export async function listenForProtocol(
  opening: Opening,
  server: ProtocolServer,
): Promise<Result<Listening, "ipc_in_use" | "port_taken">> {
  const endpoint = engineEndpoint(opening.platform);
  const bound = await endpoint.bind({
    signal: opening.signal,
    onSocket: (socket) => server.acceptIpc(socket),
  });
  if (!bound.ok) {
    return err("ipc_in_use");
  }
  opening.closers.add("ipc", async () => bound.value.close());
  opening.closers.add("server", async () => server.close());
  try {
    const http = await server.start(opening.signal);
    if (http === undefined) {
      throw new BinferenceError({
        code: "cli.no_listener",
        message: "The protocol server has no HTTP listener.",
      });
    }
    return ok({ http, ipc: endpoint.address });
  } catch (error) {
    if (error instanceof BinferenceError && error.code === "server.listen_failed") {
      return err("port_taken");
    }
    throw error;
  }
}
