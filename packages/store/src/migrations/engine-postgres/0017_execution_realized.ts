import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE executions ADD COLUMN realized_usd_micros numeric(78,0) NOT NULL DEFAULT 0;
`;

/**
 * Adds `executions.realized_usd_micros`, the realized P&L in micro-dollars, which may be below
 * zero, as engine 0017 does.
 */
export const migration: PostgresMigration = { name: "0017_execution_realized", sql };
