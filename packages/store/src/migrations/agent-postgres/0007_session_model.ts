import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE sessions
  ADD COLUMN model text COLLATE "C" CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200);
`;

/** Gives `sessions` the chat's own model (decision 0404), as agent 0007 does. */
export const migration: PostgresMigration = { name: "0007_session_model", sql };
