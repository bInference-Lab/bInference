import { BinferenceError } from "@binference/core";
import type { ConfigProblem } from "../config-issue.js";
import type { JsonObject } from "../json-value.schema.js";
import { applyEdits, type ConfigEdit } from "./config-edit.js";

/** One step that moves `config.json5` from one shape to the next. */
export interface ConfigMigration {
  /** The version this migration reads; it writes `from + 1`. */
  readonly from: number;
  /** What it changes, in one sentence; `binference check --fix` prints it. */
  readonly summary: string;
  /**
   * The edits that bring a file of version `from` to the next shape, read from the file itself.
   * A migration that only adds keys with defaults returns none.
   */
  edits(file: JsonObject): readonly ConfigEdit[];
}

/** One migration that ran: the versions, its summary and every edit it made. */
export interface MigrationStep {
  readonly from: number;
  readonly to: number;
  readonly summary: string;
  readonly edits: readonly ConfigEdit[];
}

/** The migrated file and its steps, or the problem that stops migrating. */
export type MigrationOutcome =
  | { readonly ok: true; readonly file: JsonObject; readonly steps: readonly MigrationStep[] }
  | { readonly ok: false; readonly problem: ConfigProblem };

/** The version a file names: `1` when it names none, `undefined` when `version` is no version. */
export function fileVersion(file: JsonObject): number | undefined {
  const version = file["version"] ?? 1;
  return typeof version === "number" && Number.isInteger(version) && version >= 1
    ? version
    : undefined;
}

/**
 * Checks that migrations run 1 to 2, 2 to 3 and on, with no gap and no repeat. Throws
 * `config.migrations_out_of_order` otherwise: the list is code, so this is a fault.
 */
export function assertMigrationOrder(migrations: readonly ConfigMigration[]): void {
  const wrong = migrations.findIndex((migration, index) => migration.from !== index + 1);
  if (wrong !== -1) {
    throw new BinferenceError({
      code: "config.migrations_out_of_order",
      message: `Config migration ${String(wrong)} reads version ${String(migrations[wrong]?.from)}; it must read version ${String(wrong + 1)}.`,
      details: { index: wrong },
    });
  }
}

/**
 * Runs, in order, every migration from the file's version to the latest, and raises `version`
 * after each. A file already at the latest version comes back unchanged with no steps, so a
 * second run changes nothing. A file from a newer binference is refused.
 */
export function migrateConfig(
  file: JsonObject,
  migrations: readonly ConfigMigration[],
): MigrationOutcome {
  assertMigrationOrder(migrations);
  const latest = migrations.length + 1;
  const version = fileVersion(file) ?? latest;
  if (version > latest) {
    return { ok: false, problem: { kind: "newer_version", version, supported: latest } };
  }
  let current = file;
  const steps: MigrationStep[] = [];
  for (const migration of migrations.slice(version - 1)) {
    const edits = migration.edits(current);
    const to = migration.from + 1;
    current = applyEdits(current, [...edits, { kind: "set", path: ["version"], value: to }]);
    steps.push({ from: migration.from, to, summary: migration.summary, edits });
  }
  return { ok: true, file: current, steps };
}
