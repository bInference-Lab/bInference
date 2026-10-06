import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { describeConfigSchema, renderConfigReference } from "binference";
import { z } from "zod";

const snapshotFile = "packages/cli/snapshots/config-schema.generated.json";
const referenceFile = "packages/cli/docs/config-keys.generated.md";
const migrationsFile = "packages/cli/src/config/migrations/config-migrations.ts";

const snapshotSchema = z.strictObject({
  version: z.int().positive(),
  schema: z.record(z.string(), z.unknown()),
});

// Words, defaults, key names and examples change no file's shape, so they need no migration.
const annotations = new Set([
  "description",
  "default",
  "defaultText",
  "keyName",
  "examples",
  "title",
]);

// The shape of a JSON Schema: annotations dropped and keys sorted, so a reordering is no change.
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(shapeOf);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !annotations.has(key))
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, shapeOf(item)]),
  );
}

const root = process.cwd();
const isWrite = process.argv.includes("--write");
const current = describeConfigSchema();
const generated: Readonly<Record<string, string>> = {
  [snapshotFile]: `${JSON.stringify(current, null, 2)}\n`,
  [referenceFile]: renderConfigReference(),
};

function read(file: string): string | undefined {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function writeAll(): void {
  for (const [file, text] of Object.entries(generated)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
}

// A shape change needs a new version, which only a new config migration gives.
function migrationProblem(text: string): string | undefined {
  const snapshot = snapshotSchema.parse(JSON.parse(text));
  if (snapshot.version > current.version) {
    return (
      `${snapshotFile} records version ${String(snapshot.version)}, but the config is at ` +
      `${String(current.version)}. A config migration is never removed.`
    );
  }
  const isChanged =
    JSON.stringify(shapeOf(snapshot.schema)) !== JSON.stringify(shapeOf(current.schema));
  if (isChanged && snapshot.version === current.version) {
    return (
      `the config schema changed shape without a config migration. Add one to ${migrationsFile}: ` +
      `it reads version ${String(current.version)}, writes ${String(current.version + 1)} and ` +
      "names what it changed. Then run pnpm check:config-schema --write."
    );
  }
  return undefined;
}

function staleFiles(): readonly string[] {
  return Object.entries(generated)
    .filter(([file, text]) => read(file) !== text)
    .map(([file]) => file);
}

// Returns the exit code. A shape change without a migration is never written.
function run(): number {
  const snapshot = read(snapshotFile);
  const problem = snapshot === undefined ? undefined : migrationProblem(snapshot);
  if (problem !== undefined) {
    console.error(`check:config-schema: ${problem}`);
    return 1;
  }
  const stale = staleFiles();
  if (stale.length === 0) {
    console.log(`check:config-schema: config version ${String(current.version)} is current.`);
    return 0;
  }
  if (isWrite) {
    writeAll();
    console.log(`check:config-schema: wrote ${stale.join(" and ")}.`);
    return 0;
  }
  for (const file of stale) {
    console.error(
      `check:config-schema: ${file} is behind the config schema. Run ` +
        "pnpm check:config-schema --write and commit it.",
    );
  }
  return 1;
}

process.exitCode = run();
