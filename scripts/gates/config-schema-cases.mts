import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";
import { planted } from "./planted.mjs";

const schemaFile = "packages/cli/src/config/schema/operations.schema.ts";
const migrationsFile = "packages/cli/src/config/migrations/config-migrations.ts";

const telemetryKey =
  '.strictObject({ enabled: off("Adds opt-in counts to the daily update check.") })';
const newKey =
  '.strictObject({ enabled: off("Adds opt-in counts to the daily update check."), ' +
  'detail: off("Adds more counts.") })';
// The end of the migration list, where a planted migration goes last.
const migrationListEnd = "\n];\n\n/** The version of";

// The version the config is at: one past the number of migrations in the list, written inline
// (`{`) or imported from their own file (`name,`), so the cases follow new ones.
function currentVersion(repo: string): number {
  const text = readFileSync(join(repo, migrationsFile), "utf8");
  return [...text.matchAll(/^ {2}(?:\{|\w+,)$/gm)].length + 1;
}

function newMigration(version: number): string {
  return (
    `\n  { from: ${String(version)}, summary: "Adds telemetry.detail.", edits: () => [] },` +
    migrationListEnd
  );
}

const check = ["pnpm", "check:config-schema"];
const write = [...check, "--write"];

// A shape change needs the migration that reads the current version.
function migrationCases(repo: string): readonly GateCase[] {
  const version = currentVersion(repo);
  const next = String(version + 1);
  return [
    {
      name: "a config key added without a migration fails check:config-schema",
      cost: 2,
      files: planted(repo, schemaFile, [[telemetryKey, newKey]]),
      steps: [
        { command: check, expect: "fail", output: [/changed shape without a config migration/] },
        {
          command: write,
          expect: "fail",
          output: [new RegExp(`reads version ${String(version)}, writes ${next}`)],
        },
      ],
    },
    {
      name: "a config key added with its migration passes check:config-schema once written",
      cost: 3,
      files: {
        ...planted(repo, schemaFile, [[telemetryKey, newKey]]),
        ...planted(repo, migrationsFile, [[migrationListEnd, newMigration(version)]]),
      },
      steps: [
        { command: check, expect: "fail", output: [/config-schema\.generated\.json is behind/] },
        { command: write, expect: "pass" },
        {
          command: check,
          expect: "pass",
          output: [new RegExp(`config version ${next} is current`)],
        },
      ],
    },
  ];
}

/** Cases for check:config-schema: a shape change needs a migration, and the snapshot stays current. */
export function configSchemaCases(repo: string): readonly GateCase[] {
  return [
    ...migrationCases(repo),
    {
      name: "a stale config schema snapshot fails check:config-schema",
      cost: 3,
      files: planted(repo, schemaFile, [
        ['"The release channel."', '"The channel updates come from."'],
      ]),
      steps: [
        { command: check, expect: "fail", output: [/config-schema\.generated\.json is behind/] },
        { command: write, expect: "pass" },
        { command: check, expect: "pass" },
      ],
    },
  ];
}
