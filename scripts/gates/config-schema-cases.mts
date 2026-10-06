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
const migrationList = "export const configMigrations: readonly ConfigMigration[] = [];";
const newMigration =
  "export const configMigrations: readonly ConfigMigration[] = " +
  '[{ from: 1, summary: "Adds telemetry.detail.", edits: () => [] }];';

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

/** Cases for check:config-schema: a shape change needs a migration, and generated files stay current. */
export function configSchemaCases(repo: string): readonly GateCase[] {
  return [
    {
      name: "a config key added without a migration fails check:config-schema",
      cost: 2,
      files: planted(repo, schemaFile, [[telemetryKey, newKey]]),
      steps: [
        { command: check, expect: "fail", output: [/changed shape without a config migration/] },
        { command: write, expect: "fail", output: [/reads version 1, writes 2/] },
      ],
    },
    {
      name: "a config key added with its migration passes check:config-schema once written",
      cost: 3,
      files: {
        ...planted(repo, schemaFile, [[telemetryKey, newKey]]),
        ...planted(repo, migrationsFile, [[migrationList, newMigration]]),
      },
      steps: [
        { command: check, expect: "fail", output: [/config-schema\.generated\.json is behind/] },
        { command: write, expect: "pass" },
        { command: check, expect: "pass", output: [/config version 2 is current/] },
      ],
    },
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
