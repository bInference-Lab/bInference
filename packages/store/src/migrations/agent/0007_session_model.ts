import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds a column with
// no default in place: every session kept before has no model of its own.
const sql = `
ALTER TABLE sessions ADD COLUMN model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200);
`;

/**
 * Gives `sessions` the chat's own model (decision 0404): `<provider>/<model>` that the agent set
 * for the rest of the chat, or none, so the chat runs on the configured model.
 */
export const migration: Migration = {
  name: "0007_session_model",
  up(database) {
    database.exec(sql);
  },
};
