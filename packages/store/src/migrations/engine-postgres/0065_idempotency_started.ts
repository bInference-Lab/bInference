import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE idempotency ALTER COLUMN result DROP NOT NULL;
`;

/**
 * Lets a key's `result` be empty (decision 0437): a write marks its key started, with no result,
 * before it runs, and fills the result once it answered.
 */
export const migration: PostgresMigration = { name: "0065_idempotency_started", sql };
