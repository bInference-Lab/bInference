import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GateCase } from "./gate-case.mjs";

const schemaFile = "packages/cli/src/config/schema/operations.schema.ts";
const migrationsFile = "packages/cli/src/config/migrations/config-migrations.ts";
const referenceFile = "packages/cli/docs/config-keys.generated.md";

const telemetryKey =
  '.strictObject({ enabled: off("Adds opt-in counts to the daily update check.") })';
const newKey =
  '.strictObject({ enabled: off("Adds opt-in counts to the daily update check."), ' +
  'detail: off("Adds more counts.") })';
// The end of the migration list, where a planted migration goes last.
const migrationListEnd = "\n];\n\n/** The version of";

// The version the config is at: one past the last migration's, so the cases follow new ones.
function currentVersion(repo: string): number {
  const text = readFileSync(join(repo, migrationsFile), "utf8");
  const versions = [...text.matchAll(/^\s+from: (\d+),$/gm)].map((match) => Number(match[1]));
  return Math.max(0, ...versions) + 1;
}

function newMigration(version: number): string {
  return (
    `\n  { from: ${String(version)}, summary: "Adds telemetry.detail.", edits: () => [] },` +
    migrationListEnd
  );
}

// Plants each replacement in a real file of the repo. When a file moves on, the anchor is gone
// and this throws, so a case never passes by planting nothing.
function planted(
  repo: string,
  file: string,
  replacements: readonly (readonly [string, string])[],
): Record<string, string> {
  const text = readFileSync(join(repo, file), "utf8");
  const missing = replacements.find(([anchor]) => !text.includes(anchor));
  if (missing !== undefined) {
    throw new Error(`${file} no longer holds ${missing[0]}.`);
  }
  return {
    [file]: replacements.reduce((current, [anchor, next]) => current.replace(anchor, next), text),
  };
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

/** Cases for check:config-schema: a shape change needs a migration, and generated files stay current. */
export function configSchemaCases(repo: string): readonly GateCase[] {
  return [
    ...migrationCases(repo),
    {
      name: "stale generated config docs fail check:config-schema",
      cost: 3,
      files: planted(repo, schemaFile, [
        ['"The release channel."', '"The channel updates come from."'],
      ]),
      steps: [
        { command: check, expect: "fail", output: [/config-keys\.generated\.md is behind/] },
        { command: write, expect: "pass" },
        { command: check, expect: "pass" },
      ],
    },
    {
      name: "a hand edit to the generated config docs fails check:config-schema",
      files: planted(repo, referenceFile, [["The release channel.", "The channel."]]),
      steps: [{ command: check, expect: "fail", output: [/config-keys\.generated\.md is behind/] }],
    },
  ];
}
