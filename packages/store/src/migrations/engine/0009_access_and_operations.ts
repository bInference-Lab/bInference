import type { Migration } from "../migration.js";

// Each migration keeps its own helpers: a released file never changes, and a helper it shared with
// a later migration could. A hash is 64 lowercase hex digits.
const hash = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;

const access = `
CREATE TABLE tokens (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('cli', 'runtime', 'mcp', 'custom')),
  ${json("scopes")} NOT NULL,
  ${hash("secret_hash")} UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE TABLE devices (
  id TEXT PRIMARY KEY NOT NULL,
  label TEXT NOT NULL,
  alg TEXT NOT NULL CHECK (alg IN ('ed25519', 'p256')),
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  revoked_at INTEGER
) STRICT;

CREATE TABLE pair_codes (
  ${hash("code_hash")} PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
) STRICT;

CREATE TABLE config_journal (
  id INTEGER PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  "by" TEXT NOT NULL,
  surface TEXT NOT NULL,
  path TEXT NOT NULL,
  ${json('"before"')},
  ${json('"after"')},
  reason TEXT
) STRICT;

CREATE INDEX config_journal_at ON config_journal (at);
`;

const operations = `
CREATE TABLE plugins (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  version TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('core', 'community')),
  source TEXT NOT NULL,
  hash TEXT NOT NULL,
  ${json("permissions")} NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  installed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE skills (
  id INTEGER PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  hash TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  UNIQUE (agent_id, name)
) STRICT;

CREATE TABLE jobs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'done', 'failed')),
  ${json("progress")},
  ${json("result")},
  ${json("error")},
  started_at INTEGER NOT NULL,
  ended_at INTEGER
) STRICT;

CREATE INDEX jobs_state ON jobs (state);

CREATE TABLE backups (
  id TEXT PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL CHECK (bytes >= 0),
  kind TEXT NOT NULL CHECK (
    kind IN ('daily', 'weekly', 'manual', 'before_update', 'before_migration')
  ),
  created_at INTEGER NOT NULL,
  verified_at INTEGER
) STRICT;

CREATE INDEX backups_created ON backups (created_at);

CREATE TABLE cex_connections (
  provider TEXT PRIMARY KEY NOT NULL CHECK (provider IN ('binance')),
  state TEXT NOT NULL,
  secret_ref TEXT NOT NULL,
  ${json("scopes")} NOT NULL,
  connected_at INTEGER NOT NULL
) STRICT;
`;

/**
 * Creates access and operations (database spec, section 2.8): `tokens`, `devices`, `pair_codes`,
 * `config_journal`, `plugins`, `skills`, `jobs`, `backups` and `cex_connections`. Secrets appear
 * only as SHA-256 hashes; provider tokens stay in the keychain, named by `secret_ref`.
 */
export const migration: Migration = {
  name: "0009_access_and_operations",
  up(database) {
    database.exec(access);
    database.exec(operations);
  },
};
