import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE stake_unbondings ADD COLUMN closed_outside_at bigint;
`;

/** Adds `stake_unbondings.closed_outside_at`, as engine 0056 does. */
export const migration: PostgresMigration = { name: "0056_unbondings_closed_outside", sql };
