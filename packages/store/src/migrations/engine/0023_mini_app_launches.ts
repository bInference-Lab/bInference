import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A row holds the SHA-256 of
// a launch's `hash` field, never the launch data; each sign-in deletes the rows older than 24
// hours, by `seen_at`.
const sql = `
CREATE TABLE mini_app_launches (
  launch_hash TEXT PRIMARY KEY NOT NULL CHECK (
    length(launch_hash) = 64 AND launch_hash NOT GLOB '*[^0-9a-f]*'
  ),
  seen_at INTEGER NOT NULL
) STRICT;

CREATE INDEX mini_app_launches_seen_at ON mini_app_launches (seen_at);
`;

/**
 * Creates `mini_app_launches`: the Telegram Mini App launches that signed in within the last 24
 * hours, so a launch signs in once even across a restart (decision 0160).
 */
export const migration: Migration = {
  name: "0023_mini_app_launches",
  up(database) {
    database.exec(sql);
  },
};
