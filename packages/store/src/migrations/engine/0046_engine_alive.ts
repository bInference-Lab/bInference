import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE engine_alive (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  alive_at INTEGER NOT NULL CHECK (alive_at >= 0)
) STRICT;
INSERT INTO engine_alive (id, alive_at) VALUES (1, CAST(unixepoch('subsec') * 1000 AS INTEGER));
`;

/**
 * Adds `engine_alive`, one row with when the engine last ran, which its next start reads to tell
 * how long it was off (decision 0266). The row starts at the migration's own time, so the first
 * start after the update re-checks the orders that waited through it.
 */
export const migration: Migration = {
  name: "0046_engine_alive",
  up(database) {
    database.exec(sql);
  },
};
