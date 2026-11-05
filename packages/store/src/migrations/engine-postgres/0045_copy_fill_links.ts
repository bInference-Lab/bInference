import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE order_fills ADD COLUMN copy_trade bigint CHECK (copy_trade IS NULL OR copy_trade > 0);
ALTER TABLE order_fills ADD COLUMN copy_take bigint CHECK (copy_take IS NULL OR copy_take > 0);
`;

/** Adds the leader's trade and take a copy fill came from, as engine 0045 does. */
export const migration: PostgresMigration = { name: "0045_copy_fill_links", sql };
