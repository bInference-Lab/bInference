import type { Migration } from "../migration.js";

/** Creates `meta`: the schema version, the install id and when the install began. */
export const migration: Migration = {
  name: "0001_meta",
  up(database) {
    database.exec("CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT");
  },
};
