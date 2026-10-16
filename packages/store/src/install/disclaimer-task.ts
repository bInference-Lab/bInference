import type { DatabaseSync } from "node:sqlite";
import { type DisclaimerAcceptance, disclaimerAcceptanceSchema } from "@binference/engine/install";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// `safety.disclaimer_version` holds the version as decimal text (database spec, section 2.1).
function versionOf(text: string): number {
  return z.coerce.number().int().positive().parse(text);
}

/** Reads the disclaimer the owner accepted from the `safety` row, if any. */
export function readDisclaimer(database: DatabaseSync): DisclaimerAcceptance | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("safety")
      .select(["disclaimer_version", "disclaimer_accepted_at"])
      .where("id", "=", 1),
  );
  const version = row?.disclaimer_version ?? null;
  const acceptedAtMs = row?.disclaimer_accepted_at ?? null;
  return version === null || acceptedAtMs === null
    ? undefined
    : disclaimerAcceptanceSchema.parse({ version: versionOf(version), acceptedAtMs });
}

/**
 * Keeps the disclaimer version the owner accepted and when, in the `safety` row, unless the row
 * holds that version or a later one, which stays as it is.
 */
export const acceptDisclaimerTask: StoreTask<DisclaimerAcceptance, undefined> = defineTask({
  name: "install.accept_disclaimer",
  access: "write",
  input: disclaimerAcceptanceSchema,
  output: z.undefined(),
  run(database, acceptance) {
    if (acceptance.version <= (readDisclaimer(database)?.version ?? 0)) {
      return undefined;
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    execute(
      kysely
        .updateTable("safety")
        .set((row) => ({
          disclaimer_version: String(acceptance.version),
          disclaimer_accepted_at: acceptance.acceptedAtMs,
          version: row("version", "+", 1),
        }))
        .where("id", "=", 1),
    );
    return undefined;
  },
});
