import { z } from "zod";

/** What a migration run did. */
export interface MigrationReport {
  /** The schema version before the run. */
  readonly from: number;
  /** The schema version after the run. */
  readonly to: number;
  /** The migrations this run applied, by name, in order. */
  readonly applied: readonly string[];
}

const version = z.number().int().nonnegative();

/** Checks a migration report that crossed from a store worker. */
export const migrationReportSchema: z.ZodType<MigrationReport> = z.strictObject({
  from: version,
  to: version,
  applied: z.array(z.string()),
});
