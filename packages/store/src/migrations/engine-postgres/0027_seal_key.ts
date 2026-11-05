import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE custody ADD COLUMN seal_key_public text COLLATE "C" CHECK (
  seal_key_public IS NULL OR length(seal_key_public) BETWEEN 1 AND 512
);
`;

/** Adds `custody.seal_key_public`, as engine 0027 does. */
export const migration: PostgresMigration = { name: "0027_seal_key", sql };
