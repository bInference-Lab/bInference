import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE tracked_wallets
  ADD COLUMN overflow_told_blocks bigint NOT NULL DEFAULT 0 CHECK (overflow_told_blocks >= 0);
ALTER TABLE tracked_wallets ADD COLUMN overflow_told_at bigint;
`;

/** Adds when a tracked wallet's cut blocks were last told, as engine 0043 does. */
export const migration: PostgresMigration = { name: "0043_overflow_notices", sql };
