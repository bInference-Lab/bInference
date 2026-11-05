import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE limits ADD COLUMN pending text COLLATE "C" CHECK (pending IS NULL OR pending IS JSON);
ALTER TABLE limits ADD COLUMN pending_at bigint CHECK ((pending IS NULL) = (pending_at IS NULL));
`;

/**
 * Adds the looser limits that wait, `limits.pending` and `limits.pending_at`, as engine 0013 does.
 */
export const migration: PostgresMigration = { name: "0013_pending_limits", sql };
