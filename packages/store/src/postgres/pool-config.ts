import { BinferenceError } from "@binference/core";
import type { PoolConfig } from "pg";
import type { PostgresSettings } from "./postgres-settings.js";
import { rowTypes } from "./row-types.js";

/** The session and pool limits of decision 0365, starting values a load test tunes. */
export const postgresLimits = {
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 2_000,
  idleInTransactionMs: 2_000,
  connectTimeoutMs: 5_000,
  idleTimeoutMs: 10_000,
  maxLifetimeSeconds: 1_800,
} as const;

const loopbackHosts = new Set(["127.0.0.1", "::1"]);

function isLocal(host: string): boolean {
  return loopbackHosts.has(host) || host.startsWith("/");
}

// TLS always checks the server against the given CA; only a loopback address or a socket, for
// tests and a database on the same host, may go without it.
function tlsOf(settings: PostgresSettings): PoolConfig["ssl"] {
  if (settings.ca !== undefined) {
    return { rejectUnauthorized: true, ca: settings.ca };
  }
  if (isLocal(settings.host)) {
    return false;
  }
  throw new BinferenceError({
    code: "store.postgres_plain",
    message: `A Postgres connection to ${settings.host} must use TLS: give the server's CA certificates, or connect over 127.0.0.1, ::1 or a Unix socket.`,
    details: { host: settings.host },
  });
}

/**
 * The `pg` pool options for `settings`: TLS with the CA checked, the session settings every store
 * connection starts with (timeouts, `TimeZone` UTC, an empty `search_path`, the service's
 * `application_name`), the pool limits and the row parsers. Throws `store.postgres_plain` for a
 * remote host without a CA.
 */
export function poolConfigOf(settings: PostgresSettings): PoolConfig {
  return {
    host: settings.host,
    port: settings.port,
    database: settings.database,
    user: settings.user,
    ...(settings.password === undefined ? {} : { password: settings.password }),
    ssl: tlsOf(settings),
    application_name: settings.applicationName,
    statement_timeout: postgresLimits.statementTimeoutMs,
    lock_timeout: postgresLimits.lockTimeoutMs,
    idle_in_transaction_session_timeout: postgresLimits.idleInTransactionMs,
    // Every query names its schema, so no session resolves an unnamed table anywhere.
    options: "-c search_path= -c TimeZone=UTC",
    max: settings.maxConnections,
    connectionTimeoutMillis: postgresLimits.connectTimeoutMs,
    idleTimeoutMillis: postgresLimits.idleTimeoutMs,
    maxLifetimeSeconds: postgresLimits.maxLifetimeSeconds,
    types: rowTypes(),
  };
}
