import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { z } from "zod";
import { stagePackage } from "./release/stage-package.mjs";
import { readWorkspace } from "./release/workspace-manifests.mjs";
import { runCommand, runCommandShown } from "./run-command.mjs";

// The update smoke (decision 0356): packs the binference package at three calver versions the
// way release:dry packs it, the second with a `check` that always fails and an engine migration
// past the first's schema, as a release with a new migration has, then runs
// packages/cli/src/packed/packed-update.ts on them. The old release installs with npm into a
// scratch prefix and a scratch home folder; `binference update` must put it back after the
// failing release, then install the good one. It publishes nothing and touches no login item.

const versions = { from: "2026.11.0", broken: "2026.11.1", to: "2026.11.2" } as const;
const driver = "packages/cli/src/packed/packed-update.ts";
// A `check` that fails whatever it finds, so the update must roll this release back.
const brokenCheck =
  'if (process.argv[2] === "check") { process.stdout.write(JSON.stringify({ findings: ' +
  '[{ check: "smoke.broken", level: "fail" }] }) + "\\n"); process.exit(1); }';

const packSchema = z.array(z.looseObject({ filename: z.string() }));

function fail(message: string): never {
  console.error(`update:smoke: ${message}`);
  process.exit(1);
}

function build(root: string): void {
  const command = [
    "pnpm",
    "turbo",
    "run",
    "build",
    "--filter",
    "binference...",
    "--output-logs=errors-only",
  ];
  if (runCommandShown(command, { cwd: root }) !== 0) {
    fail("the build failed; its errors are above.");
  }
}

// The engine migrations of the bundled store, as tsdown writes them.
const migrationsFile = ["node_modules", "@binference", "store", "dist", "migrations", "engine"];
const migrationsEnd = "\n];\n//#endregion\nexport { engineMigrations };";
// One more engine migration, named after the last one's number, as the store checks the order,
// so the release's engine moves the records past the old release.
function addedMigration(folder: string): string {
  const numbers = readdirSync(folder).flatMap((name) => /^(\d{4})_/.exec(name)?.[1] ?? []);
  const next = String(Math.max(...numbers.map(Number)) + 1).padStart(4, "0");
  return (
    `,\n\t{ name: "${next}_update_smoke", up(database) { ` +
    'database.exec("CREATE TABLE update_smoke_rows (id INTEGER PRIMARY KEY);"); } }'
  );
}

// Plants the failing check after the entry's first line, the shebang, and adds the migration.
function breakRelease(stage: string): void {
  const main = join(stage, "dist", "main.mjs");
  const [first = "", ...rest] = readFileSync(main, "utf8").split("\n");
  writeFileSync(main, [first, brokenCheck, ...rest].join("\n"));
  const folder = join(stage, ...migrationsFile);
  const migrations = join(folder, "engine-migrations.mjs");
  const text = readFileSync(migrations, "utf8");
  if (!text.endsWith(`${migrationsEnd}\n`)) {
    fail(`${migrations} no longer ends as the smoke expects; plant the migration anew.`);
  }
  writeFileSync(
    migrations,
    `${text.slice(0, -migrationsEnd.length - 1)}${addedMigration(folder)}${migrationsEnd}\n`,
  );
}

function pack(root: string, out: string, name: keyof typeof versions): string {
  const stage = join(out, "stage", name);
  stagePackage({ workspace: readWorkspace(root), version: versions[name] }, "binference", stage);
  if (name === "broken") {
    breakRelease(stage);
  }
  const result = runCommand(
    ["npm", "pack", "--json", "--ignore-scripts", "--loglevel=error", "--pack-destination", out],
    { cwd: stage },
  );
  const [packed] = result.status === 0 ? packSchema.parse(JSON.parse(result.output)) : [];
  return packed?.filename ?? fail(`npm pack failed for ${versions[name]}:\n${result.output}`);
}

const root = process.cwd();
const out = join(root, "reports", "update-smoke");
const started = performance.now();
build(root);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const files = {
  from: pack(root, out, "from"),
  broken: pack(root, out, "broken"),
  to: pack(root, out, "to"),
};
writeFileSync(join(out, "update-smoke.json"), `${JSON.stringify({ versions, files }, null, 2)}\n`);
const node = ["node", "--conditions=@binference/source", "--import", "tsx"];
const status = runCommandShown([...node, driver, out], { cwd: root });
const seconds = Math.round((performance.now() - started) / 1000);
console.log(`update:smoke: ${status === 0 ? "passed" : "failed"} in ${String(seconds)} s.`);
process.exitCode = status === 0 ? 0 : 1;
