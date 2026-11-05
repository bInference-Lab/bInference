import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN rescue_reach text COLLATE "C"
  CHECK (rescue_reach IS NULL OR rescue_reach IS JSON ARRAY);
`;

/** Adds `safety.rescue_reach`, a JSON array, as engine 0054 does. */
export const migration: PostgresMigration = { name: "0054_rescue_reach", sql };
