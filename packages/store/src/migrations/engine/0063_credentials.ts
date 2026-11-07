import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A name is written as an
// environment variable's; the hosts are a JSON array of lower-case host names.
const sql = `
CREATE TABLE credentials (
  name TEXT PRIMARY KEY NOT NULL CHECK (length(name) BETWEEN 1 AND 64 AND name GLOB '[A-Z]*' AND name NOT GLOB '*[^A-Z0-9_]*'),
  value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 65536),
  allowed_hosts TEXT NOT NULL CHECK (json_valid(allowed_hosts) AND json_type(allowed_hosts) = 'array'),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  deleted_at INTEGER CHECK (deleted_at IS NULL OR deleted_at >= 0)
) STRICT;
`;

/**
 * Makes `credentials` (decision 0388): each credential the owner stored for the agents, by name,
 * with its value, the exact hosts it may be sent to, when the owner last stored it, and when it
 * was removed: a removed one is gone from every read and purged after 30 days. Only the owner
 * writes a value, and no read gives it back but the one that sends it.
 */
export const migration: Migration = {
  name: "0063_credentials",
  up(database) {
    database.exec(sql);
  },
};
