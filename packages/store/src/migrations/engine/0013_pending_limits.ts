import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE limits ADD COLUMN pending TEXT CHECK (pending IS NULL OR json_valid(pending));
ALTER TABLE limits ADD COLUMN pending_at INTEGER CHECK ((pending IS NULL) = (pending_at IS NULL));
`;

/**
 * Adds `limits.pending` and `limits.pending_at`: an agent's looser limits that wait 24 hours, every
 * limit as it will be from `pending_at`, as JSON in the encoding of the limits columns (decision
 * 0111).
 */
export const migration: Migration = {
  name: "0013_pending_limits",
  up(database) {
    database.exec(sql);
  },
};
