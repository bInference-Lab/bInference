import { describe, expect, it } from "vitest";
import { assertServerVersion } from "./open-postgres.js";
import { poolConfigOf } from "./pool-config.js";
import type { PostgresSettings } from "./postgres-settings.js";

const settings: PostgresSettings = {
  host: "db.internal.example",
  port: 5432,
  database: "binference",
  user: "binference_worker",
  ca: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n",
  applicationName: "binference-worker",
  maxConnections: 10,
};

describe("the Postgres pool options", () => {
  it("check the server's certificate against the given CA", () => {
    expect(poolConfigOf(settings).ssl).toStrictEqual({ rejectUnauthorized: true, ca: settings.ca });
  });

  it("refuse a remote host without TLS", () => {
    const { ca: _ca, ...plain } = settings;
    expect(() => poolConfigOf(plain)).toThrow(
      expect.objectContaining({ code: "store.postgres_plain" }),
    );
  });

  it.each(["127.0.0.1", "::1", "/var/run/postgresql"])("allow %s without TLS", (host) => {
    const { ca: _ca, ...plain } = settings;
    expect(poolConfigOf({ ...plain, host }).ssl).toBe(false);
  });

  it("refuse localhost without TLS, since a name can resolve elsewhere", () => {
    const { ca: _ca, ...plain } = settings;
    expect(() => poolConfigOf({ ...plain, host: "localhost" })).toThrow(
      expect.objectContaining({ code: "store.postgres_plain" }),
    );
  });

  it("start each session with the store's timeouts and an empty search path", () => {
    expect(poolConfigOf(settings)).toMatchObject({
      statement_timeout: 5_000,
      lock_timeout: 2_000,
      idle_in_transaction_session_timeout: 2_000,
      options: "-c search_path= -c TimeZone=UTC",
      application_name: "binference-worker",
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      maxLifetimeSeconds: 1_800,
    });
  });
});

describe("the Postgres server check", () => {
  it("refuses a server older than Postgres 17", () => {
    expect(() => {
      assertServerVersion(160_004);
    }).toThrow(expect.objectContaining({ code: "store.postgres_too_old" }));
  });

  it("takes Postgres 17", () => {
    expect(() => {
      assertServerVersion(170_000);
    }).not.toThrow();
  });
});
