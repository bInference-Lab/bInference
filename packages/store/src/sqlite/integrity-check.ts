import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { SqliteRow } from "../dialect/assert-query-rows.js";
import { readSchemaVersion } from "../migrations/schema-version.js";
import type { ForeignKeyProblem, IntegrityReport } from "./integrity-report.js";

const problemLimit = 100;
const integrityRow = z.object({ integrity_check: z.string() });
const foreignKeyRow = z.object({
  table: z.string(),
  rowid: z.number().int().nullable(),
  parent: z.string(),
});
const pageCountRow = z.object({ page_count: z.number().int() });
const freePagesRow = z.object({ freelist_count: z.number().int() });

// Reads at most `problemLimit` rows: a badly damaged file can report a problem per page.
function firstRows(database: DatabaseSync, sql: string): SqliteRow[] {
  const iterator = database.prepare(sql).iterate();
  const rows: SqliteRow[] = [];
  try {
    for (const row of iterator) {
      rows.push(row);
      if (rows.length >= problemLimit) {
        break;
      }
    }
  } finally {
    iterator.return?.();
  }
  return rows;
}

function foreignKeyProblems(database: DatabaseSync): ForeignKeyProblem[] {
  return firstRows(database, "PRAGMA foreign_key_check").map((row) => {
    const { table, rowid, parent } = foreignKeyRow.parse(row);
    return { table, rowid, parent };
  });
}

/**
 * Runs SQLite's integrity and foreign key checks and compares the schema version with the one
 * this build expects. It reads only, so it runs on a reader while the writer works.
 */
export function checkIntegrity(database: DatabaseSync, expectedVersion: number): IntegrityReport {
  const integrity = firstRows(database, `PRAGMA integrity_check(${String(problemLimit)})`).map(
    (row) => integrityRow.parse(row).integrity_check,
  );
  const foreignKeys = foreignKeyProblems(database);
  const schemaVersion = readSchemaVersion(database);
  const ok =
    integrity.length === 1 &&
    integrity[0] === "ok" &&
    foreignKeys.length === 0 &&
    schemaVersion === expectedVersion;
  return {
    ok,
    integrity,
    foreignKeys,
    schemaVersion,
    expectedVersion,
    pageCount: pageCountRow.parse(database.prepare("PRAGMA page_count").get()).page_count,
    freePages: freePagesRow.parse(database.prepare("PRAGMA freelist_count").get()).freelist_count,
  };
}
