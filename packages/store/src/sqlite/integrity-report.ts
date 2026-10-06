import { z } from "zod";

/** A row that names a parent row that does not exist. */
export interface ForeignKeyProblem {
  readonly table: string;
  /** The child row's rowid; null for a table without rowids. */
  readonly rowid: number | null;
  readonly parent: string;
}

/** The result of `checkIntegrity`: SQLite's own checks and the schema version. */
export interface IntegrityReport {
  /** True when SQLite found nothing and the schema version is the one this build expects. */
  readonly ok: boolean;
  /** `["ok"]`, or the first 100 problems `PRAGMA integrity_check` reports. */
  readonly integrity: readonly string[];
  /** The first 100 rows `PRAGMA foreign_key_check` reports. */
  readonly foreignKeys: readonly ForeignKeyProblem[];
  readonly schemaVersion: number;
  readonly expectedVersion: number;
  /** Pages in the file, and how many of them are free: `check --fix` vacuums above 20%. */
  readonly pageCount: number;
  readonly freePages: number;
}

const count = z.number().int().nonnegative();

/** Checks an integrity report that crossed from a store worker. */
export const integrityReportSchema: z.ZodType<IntegrityReport> = z.strictObject({
  ok: z.boolean(),
  integrity: z.array(z.string()),
  foreignKeys: z.array(
    z.strictObject({ table: z.string(), rowid: z.number().int().nullable(), parent: z.string() }),
  ),
  schemaVersion: count,
  expectedVersion: count,
  pageCount: count,
  freePages: count,
});
