import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN rescue_ceiling text COLLATE "C"
  CHECK (rescue_ceiling IS NULL OR rescue_ceiling IS JSON);
`;

/** Adds `safety.rescue_ceiling`, as engine 0012 does. */
export const migration: PostgresMigration = { name: "0012_rescue_ceiling", sql };
