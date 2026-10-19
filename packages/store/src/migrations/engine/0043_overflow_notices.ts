import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Both columns take a
// default, so SQLite adds them in place.
const sql = `
ALTER TABLE tracked_wallets
  ADD COLUMN overflow_told_blocks INTEGER NOT NULL DEFAULT 0 CHECK (overflow_told_blocks >= 0);
ALTER TABLE tracked_wallets ADD COLUMN overflow_told_at INTEGER;
`;

/**
 * Adds to `tracked_wallets` the cut blocks the owner was told of, and when (decision 0250): a
 * wallet's notice tells the blocks cut since, at most once a day.
 */
export const migration: Migration = {
  name: "0043_overflow_notices",
  up(database) {
    database.exec(sql);
  },
};
