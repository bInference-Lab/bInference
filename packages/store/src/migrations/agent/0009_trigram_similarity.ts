import type { Migration } from "../migration.js";

/**
 * Keeps the agent database's version in step with its Postgres form, which adds the function a
 * note search ranks by there. SQLite ranks a search by `notes_fts`, so nothing here changes.
 */
export const migration: Migration = {
  name: "0009_trigram_similarity",
  up() {
    // No statement: `notes_fts` already gives a search its rank on SQLite.
  },
};
