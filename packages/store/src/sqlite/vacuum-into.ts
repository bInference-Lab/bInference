import { existsSync, rmSync, statSync } from "node:fs";
import { resolve, toNamespacedPath } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";

/** The copy `vacuumInto` wrote. */
export interface VacuumCopy {
  readonly file: string;
  readonly bytes: number;
}

/** What `vacuumInto` returns: the copy, or `target_exists` when the target file is there. */
export type VacuumOutcome = Result<VacuumCopy, "target_exists">;

/** Checks a `vacuumInto` outcome that crossed from a store worker. */
export const vacuumOutcomeSchema: z.ZodType<VacuumOutcome> = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    value: z.strictObject({ file: z.string(), bytes: z.number().int().nonnegative() }),
  }),
  z.strictObject({ ok: z.literal(false), error: z.literal("target_exists") }),
]);

/**
 * Writes a compact, consistent copy of the database to `target` with `VACUUM INTO`. It reads one
 * snapshot, so writers keep working. It never replaces a file: an existing target returns
 * `target_exists`. The target's folder must exist.
 */
export function vacuumInto(database: DatabaseSync, target: string): VacuumOutcome {
  const file = resolve(target);
  if (existsSync(file)) {
    return err("target_exists");
  }
  // A reader is query_only, which refuses VACUUM INTO although the source only reads. The
  // statement runs synchronously, so nothing else uses the connection while the guard is off.
  const queryOnly = database.prepare("PRAGMA query_only").get()?.["query_only"] === 1;
  database.exec("PRAGMA query_only = OFF");
  try {
    database.prepare("VACUUM INTO ?").run(toNamespacedPath(file));
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  } finally {
    database.exec(queryOnly ? "PRAGMA query_only = ON" : "PRAGMA query_only = OFF");
  }
  return ok({ file, bytes: statSync(file).size });
}
