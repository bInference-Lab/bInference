import type { Migration } from "../migration.js";

// Each migration keeps its own helpers: a released file never changes, and a helper it shared with
// a later migration could.
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;
const count = (column: string): string =>
  `${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} >= 0)`;

const sql = `
CREATE TABLE inbox (
  id INTEGER PRIMARY KEY NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('telegram', 'webhook')),
  source_key TEXT NOT NULL UNIQUE,
  ${json("payload")} NOT NULL,
  received_at INTEGER NOT NULL,
  handled_at INTEGER
) STRICT;

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY NOT NULL,
  surface TEXT NOT NULL,
  ${json("target")} NOT NULL,
  ${json("payload")} NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'sent', 'unknown_after_send', 'failed')),
  ${count("attempts")},
  next_at INTEGER,
  ref TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
) STRICT;

CREATE INDEX outbox_state_next ON outbox (state, next_at);

CREATE TABLE notices (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT REFERENCES agents (id),
  kind TEXT NOT NULL,
  i18n_key TEXT NOT NULL,
  ${json('"values"')} NOT NULL,
  level TEXT NOT NULL,
  at INTEGER NOT NULL,
  ${json("delivered")} NOT NULL
) STRICT;

CREATE INDEX notices_at ON notices (at);

CREATE TABLE idempotency (
  credential TEXT NOT NULL,
  op TEXT NOT NULL,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  args_hash TEXT NOT NULL CHECK (length(args_hash) = 64 AND args_hash NOT GLOB '*[^0-9a-f]*'),
  ${json("result")} NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (credential, op, key)
) STRICT;

CREATE TABLE model_usage (
  id INTEGER PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  turn_id TEXT,
  model TEXT NOT NULL,
  ${count("input_tokens")},
  ${count("output_tokens")},
  ${count("cached_tokens")},
  usd_micros TEXT NOT NULL CHECK (
    usd_micros != '' AND usd_micros NOT GLOB '*[^0-9]*'
    AND (usd_micros = '0' OR usd_micros NOT GLOB '0*') AND length(usd_micros) <= 78
  ),
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX model_usage_agent_at ON model_usage (agent_id, at);
`;

/**
 * Creates the surfaces' delivery and idempotency tables (database spec, section 2.7): `inbox`,
 * `outbox`, `notices`, `idempotency` and `model_usage`.
 */
export const migration: Migration = {
  name: "0008_surfaces_and_delivery",
  up(database) {
    database.exec(sql);
  },
};
