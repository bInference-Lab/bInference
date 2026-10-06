import type { Migration } from "../migration.js";

/** Creates `meta`, which holds the agent database's schema version. */
export const migration: Migration = {
  name: "0001_meta",
  up(database) {
    database.exec("CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT");
  },
};
