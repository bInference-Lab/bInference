import { BinferenceError } from "@binference/core";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Client, DatabaseError, Pool } from "pg";
import { createCommitStatus } from "./commit-status.js";
import { poolConfigOf } from "./pool-config.js";
import { storeFaultOf } from "./postgres-error.js";
import type { PostgresSettings } from "./postgres-settings.js";
import { postgresRead, postgresWrite } from "./postgres-transaction.js";
import type { PostgresWork, RetryPorts } from "./write-once.js";

function ignore(): void {
  // Each client's own listener logs the error.
}

/** The oldest server the store runs on: Postgres 17 (decision 0365). */
const oldestServerVersion = 170_000;

/** A pool of store connections to one Postgres database, whose tables `Schema` types. */
export interface PostgresDatabase<Schema> {
  /** Runs `work` in one serializable write transaction, retried on a conflict. */
  write<Output>(work: PostgresWork<Schema, Output>, signal: AbortSignal): Promise<Output>;
  /** Runs `work` in one repeatable-read, read-only transaction. */
  read<Output>(work: PostgresWork<Schema, Output>, signal: AbortSignal): Promise<Output>;
  /** Waits for every connection to finish and closes them. */
  close(): Promise<void>;
}

async function serverVersion<Schema>(kysely: Kysely<Schema>, signal: AbortSignal): Promise<number> {
  const query = sql<{ version: string }>`select current_setting('server_version_num') as version`;
  const { rows } = await kysely.executeQuery(query.compile(kysely), {
    signal,
    inflightQueryAbortStrategy: "cancel query",
  });
  return Number(rows[0]?.version ?? 0);
}

/** Refuses a server older than Postgres 17 with `store.postgres_too_old`. */
export function assertServerVersion(version: number): void {
  if (version < oldestServerVersion) {
    throw new BinferenceError({
      code: "store.postgres_too_old",
      message: `The Postgres server runs version ${String(version)}; the store needs Postgres 17 or later. Upgrade the server.`,
      details: { serverVersion: version, oldestVersion: oldestServerVersion },
    });
  }
}

async function assertServer<Schema>(kysely: Kysely<Schema>, signal: AbortSignal): Promise<void> {
  let version: number;
  try {
    version = await serverVersion(kysely, signal);
  } catch (error) {
    throw storeFaultOf(error, signal);
  }
  assertServerVersion(version);
}

/**
 * Opens a pool on the database `settings` name (decision 0365): TLS with the server's CA checked,
 * the store's session settings and limits, and its row parsers. It checks the server before it
 * returns and refuses one older than Postgres 17 with `store.postgres_too_old`. A session the
 * server ends goes to the log as a fault, whether the pool or a call held it, and never ends the
 * process. Every call takes a signal; a write retries a conflict through the given clock and
 * random source, and asks how it ended when its COMMIT answer is lost (decision 0438).
 */
export async function openPostgres<Schema>(
  settings: PostgresSettings,
  options: RetryPorts & { readonly signal: AbortSignal },
): Promise<PostgresDatabase<Schema>> {
  const pool = new Pool(poolConfigOf(settings));
  // A session the server ends emits `error` on its client: an idle one through the pool, one a
  // call holds (a transaction idle past `idle_in_transaction_session_timeout`) on the client alone.
  // Unheard, either would end the process. Each client's own listener logs it; the call's next
  // statement fails, and the pool drops the client.
  pool.on("connect", (client) => {
    client.on("error", (error) => {
      options.logger.error("store.postgres_pool_error", {
        errorCode: error instanceof DatabaseError ? (error.code ?? "") : "",
      });
    });
  });
  pool.on("error", ignore);
  const kysely = new Kysely<Schema>({ dialect: new PostgresDialect({ pool }) });
  try {
    await assertServer(kysely, options.signal);
  } catch (error) {
    await kysely.destroy();
    throw error;
  }
  // The cancel's connection takes the pool's settings, so its connect and its statement end
  // within their timeouts; nothing waits for its close.
  const cancel = async (processId: number): Promise<void> => {
    const client = new Client(poolConfigOf(settings));
    try {
      await client.connect();
      await client.query("select pg_cancel_backend($1)", [processId]);
    } catch (error) {
      options.logger.warn("store.postgres_cancel_failed", {
        errorCode: error instanceof DatabaseError ? (error.code ?? "") : "",
      });
    } finally {
      void client.end().catch(() => undefined);
    }
  };
  // A write whose COMMIT answer was lost asks how it ended on a connection of its own (decision
  // 0438), so a pool whose connections broke can still ask; TCP keepalive finds a dead path even
  // between the check's own deadlines.
  const status = createCommitStatus(
    () => new Client({ ...poolConfigOf(settings), keepAlive: true }),
    options.logger,
  );
  return {
    write: async (work, signal) => postgresWrite(kysely, work, { ...options, signal, status }),
    read: async (work, signal) => postgresRead(kysely, work, { signal, cancel }),
    close: async () => kysely.destroy(),
  };
}
