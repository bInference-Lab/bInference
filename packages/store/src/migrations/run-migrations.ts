import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import { writeTransaction } from "../sqlite/transaction.js";
import type { MigrationReport } from "./migration-report.js";
import type { Migration } from "./migration.js";
import { readSchemaVersion, writeSchemaVersion } from "./schema-version.js";

const migrationName = /^(\d{4})_[a-z0-9]+(?:_[a-z0-9]+)*$/;

function orderFault(name: string, expected: number): BinferenceError {
  return new BinferenceError({
    code: "store.migration_order",
    message: `Migration ${name} is out of place: migrations are named NNNN_name and numbered from 0001 with no gap, and this one should carry ${String(expected).padStart(4, "0")}.`,
    details: { migration: name, expected },
  });
}

/**
 * The version of the newest migration in `migrations`, after checking that they are named
 * `NNNN_name` and numbered 1, 2, 3 in order with no gap. Throws `store.migration_order`.
 */
export function latestVersion(migrations: readonly Migration[]): number {
  migrations.forEach((migration, index) => {
    const match = migrationName.exec(migration.name);
    if (match === null || Number(match[1]) !== index + 1) {
      throw orderFault(migration.name, index + 1);
    }
  });
  return migrations.length;
}

/**
 * Refuses a database that a newer binference migrated: an older build must never write a schema
 * it does not know. Throws `store.newer_schema` with both versions.
 */
export function assertKnownVersion(database: string, found: number, latest: number): void {
  if (found > latest) {
    throw new BinferenceError({
      code: "store.newer_schema",
      message: `The ${database} database has schema version ${String(found)}, newer than the ${String(latest)} this binference knows. Update binference, or restore the backup taken before the update.`,
      details: { database, schemaVersion: found, supportedVersion: latest },
    });
  }
}

function migrationFault(
  migration: Migration,
  version: number,
  cause: Error["cause"],
): BinferenceError {
  return new BinferenceError({
    code: "store.migration_failed",
    message: `Migration ${migration.name} failed and rolled back whole; the database stays at schema version ${String(version - 1)}.`,
    cause,
    details: {
      migration: migration.name,
      schemaVersion: version - 1,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
}

// Another connection may have migrated since the version was read, so the version is read again
// under the write lock, and the migration and its version bump commit together.
function applyMigration(database: DatabaseSync, migration: Migration, version: number): boolean {
  try {
    return writeTransaction(database, () => {
      if (readSchemaVersion(database) >= version) {
        return false;
      }
      migration.up(database);
      writeSchemaVersion(database, version);
      return true;
    });
  } catch (error) {
    throw migrationFault(migration, version, error);
  }
}

/** What {@link runMigrations} migrates: a database's name and its migrations in order. */
export interface MigrationPlan {
  readonly name: string;
  readonly migrations: readonly Migration[];
}

/**
 * Applies the migrations the database lacks, each in its own transaction with its version bump.
 * A failed migration rolls back whole and throws `store.migration_failed`; the migrations before
 * it stay applied.
 */
export function runMigrations(database: DatabaseSync, plan: MigrationPlan): MigrationReport {
  const latest = latestVersion(plan.migrations);
  const from = readSchemaVersion(database);
  assertKnownVersion(plan.name, from, latest);
  const applied: string[] = [];
  for (const [index, migration] of plan.migrations.slice(from).entries()) {
    if (applyMigration(database, migration, from + index + 1)) {
      applied.push(migration.name);
    }
  }
  return { from, to: readSchemaVersion(database), applied };
}
