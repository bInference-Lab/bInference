// Postgres store tests run on the server the Postgres project's global setup gives them
// (config/vitest/postgres-setup.ts), each file in a database of its own. Nothing in production
// uses this file.
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import type { PostgresSettings } from "../postgres/postgres-settings.js";

declare module "vitest" {
  interface ProvidedContext {
    /** The test server's URL, or an empty text when none runs and the Postgres tests skip. */
    readonly postgres: string;
  }
}

/** A database of its own for one test file, on the test server. */
export interface TestPostgresDatabase {
  readonly settings: PostgresSettings;
  /** Drops the database, ending any connection still open on it. */
  drop(): Promise<void>;
}

/** The settings a test connects with, read from the test server's URL. */
function testPostgresSettings(url: string): PostgresSettings {
  const parsed = new URL(url);
  return {
    host: parsed.hostname.replace(/^\[(.*)\]$/, "$1"),
    port: Number(parsed.port === "" ? "5432" : parsed.port),
    database: decodeURIComponent(parsed.pathname.slice(1)) || "postgres",
    user: decodeURIComponent(parsed.username) || "postgres",
    ...(parsed.password === "" ? {} : { password: decodeURIComponent(parsed.password) }),
    applicationName: "binference-test",
    maxConnections: 4,
  };
}

/** Creates an empty database with a fresh name on the test server. */
export async function createTestPostgresDatabase(url: string): Promise<TestPostgresDatabase> {
  const server = testPostgresSettings(url);
  const name = `bnf_${randomBytes(8).toString("hex")}`;
  const admin = async (statement: string): Promise<void> => {
    const client = new Client({ ...server, ssl: false });
    await client.connect();
    try {
      await client.query(statement);
    } finally {
      await client.end();
    }
  };
  await admin(`CREATE DATABASE ${name}`);
  return {
    settings: { ...server, database: name },
    drop: async () => admin(`DROP DATABASE ${name} WITH (FORCE)`),
  };
}
