import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. NULL until the owner key
// was entered once since the install kept it.
const sql = `
ALTER TABLE custody ADD COLUMN seal_key_public TEXT CHECK (
  seal_key_public IS NULL OR length(seal_key_public) BETWEEN 1 AND 512
);
`;

/**
 * Adds `custody.seal_key_public`: the public half of the sealing key the owner key derives, which
 * backups are sealed to (keys spec, section 7.2).
 */
export const migration: Migration = {
  name: "0027_seal_key",
  up(database) {
    database.exec(sql);
  },
};
