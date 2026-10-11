import {
  type ChainRef,
  type ChainRegistry,
  chainRefSchema,
  createChainRegistry,
  type PriceFeedDefinition,
  type Venue,
} from "@binference/chain";
import { createEvmFamily, createEvmSigningScheme } from "@binference/chain-evm";
import { bsc, bscPriceFeeds } from "@binference/chains";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { EngineStores, PositionStore, RiskCacheStore } from "@binference/engine";
import type { BackupFailure } from "@binference/engine/backups";
import { ensurePrivateFolder, openLogFile, type Platform } from "@binference/platform";
import type { ProtocolServer, ServerAddress } from "@binference/server";
import {
  createSqliteBackupStore,
  createSqliteEngineStores,
  createSqlitePositionStore,
  createSqliteRiskCacheStore,
  engineWorker,
  openDatabase,
} from "@binference/store";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { ConfigOutcome } from "../config/validate-config.js";
import { createFileLogger, type EngineLogger } from "../logging/file-logger.js";
import type { CliHost } from "../program/cli-host.js";
import type { Closers } from "./closers.js";
import { type BackupSources, backUpBeforeMigration, backupPartsOf } from "./compose-backups.js";
import type { SetUpInstall } from "./compose-lock.js";
import type { ConfigCell } from "./config-cell.js";
import { engineEndpoint, engineLogFile } from "./engine-locations.js";
import type { OpenedBot } from "./open-bot.js";

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
  /** The config the engine started with: what a part that copies a key at start reads. */
  readonly config: BinferenceConfig;
  /** The config as reloaded, for the parts that read a key on each use (decision 0118). */
  readonly settings: ConfigCell;
  /** Reads the config again in the same layers, as a reload does. */
  readonly readConfig: (signal: AbortSignal) => Promise<ConfigOutcome>;
  readonly log: OpenedLog;
  readonly stores: OpenedStores;
  /** The install, or `undefined` before `binference init` set it up. */
  readonly install: SetUpInstall | undefined;
  /** The owner's tracing RPC of each chain config names one for, read from its secret. */
  readonly tracers: ReadonlyMap<ChainRef, string>;
  /** The chains this binference serves. */
  readonly chains: ChainRegistry;
  /** The venues it quotes on, their keys read. */
  readonly venues: readonly Venue[];
  /** The owner's bot, or `undefined` when its token could not be read. */
  readonly bot: OpenedBot | undefined;
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

/**
 * Opens `logs/engine.log` with the config's size and age limits, and the logger on it, writing
 * from the level the config cell holds at each record.
 */
export async function openEngineLog(opening: Opening, settings: ConfigCell): Promise<OpenedLog> {
  const config = settings.current();
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
    level: () => settings.current().logging.level,
    clock: host.clock,
    subsystem: "engine",
  });
  opening.closers.add("logs", async () => logger.close());
  return { logger, file, hasFailed: () => state.failed };
}

/** The store ports on `engine.sqlite`: the engine's, the risk step's cache and the positions. */
interface OpenedStores extends EngineStores {
  readonly riskCache: RiskCacheStore;
  /** Executions, arrivals, departures and the positions they move, paper and live. */
  readonly positions: PositionStore;
  /** The record of each backup, and the database a backup snapshots. */
  readonly backups: BackupSources;
}

/**
 * The stores, or why `engine.sqlite` did not open: its integrity check, or the backup a migration
 * waits for.
 */
export type OpenedStoresOutcome =
  | { readonly ok: true; readonly stores: OpenedStores }
  | { readonly ok: false; readonly refusal: "store_damaged" }
  | { readonly ok: false; readonly refusal: "backup_failed"; readonly reason: BackupFailure };

/**
 * Opens `engine.sqlite` on its store workers, backs it up when a migration is ahead, applies its
 * migrations and checks its integrity. Answers the store ports, or why it stopped: a backup before
 * a migration that failed, so the migration never ran, or a failed integrity check.
 */
export async function openEngineStores(
  opening: Opening,
  parts: { readonly logger: EngineLogger; readonly config: BinferenceConfig },
): Promise<OpenedStoresOutcome> {
  const { logger } = parts;
  const database = await openDatabase({
    file: opening.platform.stateFolder.engineDatabase,
    worker: engineWorker,
    execArgv: opening.host.workerExecArgv ?? [],
    signal: opening.signal,
  });
  opening.closers.add("store", async () => database.close());
  const stores = createSqliteEngineStores(database);
  const backups = { database, install: stores.install, backups: createSqliteBackupStore(database) };
  const backing = backupPartsOf(opening, backups, logger);
  const backedUp = await backUpBeforeMigration(backing, parts.config, opening.signal);
  if (!backedUp.ok) {
    return { ok: false, refusal: "backup_failed", reason: backedUp.error };
  }
  await database.migrate({ signal: opening.signal });
  logger.info("store.migrated");
  const integrity = await database.checkIntegrity({ signal: opening.signal });
  if (!integrity.ok) {
    logger.error("store.integrity_failed");
    return { ok: false, refusal: "store_damaged" };
  }
  const opened = {
    ...stores,
    riskCache: createSqliteRiskCacheStore(database),
    positions: createSqlitePositionStore(database),
    backups,
  };
  return { ok: true, stores: opened };
}

/** The chains this binference serves: BSC on the EVM family. */
export function selfHostedChains(): ChainRegistry {
  return createChainRegistry({
    chains: [bsc],
    families: [createEvmFamily()],
    signingSchemes: [createEvmSigningScheme()],
  });
}

/** The Chainlink feeds of each chain this binference serves, as the registry names them. */
export function selfHostedFeeds(): ReadonlyMap<ChainRef, readonly PriceFeedDefinition[]> {
  return new Map([[chainRefSchema.parse(bsc.id), bscPriceFeeds]]);
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
