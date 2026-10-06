import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import { createSyncKysely } from "../dialect/sync-kysely.js";

interface VersionTables {
  meta: { key: string; value: string };
  sqlite_master: { type: string; name: string };
}

const versionKey = "schema_version";
const versionText = /^(?:0|[1-9]\d{0,8})$/;

/** The schema version in `meta`, or 0 for a database no migration has touched. */
export function readSchemaVersion(database: DatabaseSync): number {
  const { kysely, takeFirst } = createSyncKysely<VersionTables>(database);
  const table = takeFirst(
    kysely
      .selectFrom("sqlite_master")
      .select("name")
      .where("type", "=", "table")
      .where("name", "=", "meta"),
  );
  if (table === undefined) {
    return 0;
  }
  const row = takeFirst(kysely.selectFrom("meta").select("value").where("key", "=", versionKey));
  if (row === undefined) {
    return 0;
  }
  if (!versionText.test(row.value)) {
    throw new BinferenceError({
      code: "store.bad_schema_version",
      message: `meta.schema_version holds ${JSON.stringify(row.value)}, which is not a version; restore the database from a backup.`,
    });
  }
  return Number(row.value);
}

/** Records `version` in `meta`. Called inside the transaction of the migration it records. */
export function writeSchemaVersion(database: DatabaseSync, version: number): void {
  const { kysely, execute } = createSyncKysely<VersionTables>(database);
  const value = String(version);
  execute(
    kysely
      .insertInto("meta")
      .values({ key: versionKey, value })
      .onConflict((conflict) => conflict.column("key").doUpdateSet({ value })),
  );
}
