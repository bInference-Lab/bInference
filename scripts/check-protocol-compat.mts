import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { describeProtocol } from "@binference/protocol";
import { z } from "zod";
import { compareSchemaSets, type SchemaChange } from "./protocol-compat/compare-schemas.mjs";

const versionFile = "packages/protocol/src/versions/protocol-version.ts";
const snapshotSchema = z.strictObject({
  version: z.int().positive(),
  schemas: z.record(z.string(), z.unknown()),
});

const root = process.cwd();
const isWrite = process.argv.includes("--write");
const current = describeProtocol();
const version = `v${String(current.version)}`;
const snapshotFile = `packages/protocol/snapshots/${version}.generated.json`;
const currentText = `${JSON.stringify(current, null, 2)}\n`;

function readSnapshot(): string | undefined {
  const path = join(root, snapshotFile);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function writeSnapshot(): void {
  const path = join(root, snapshotFile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, currentText);
}

function print(changes: readonly SchemaChange[]): void {
  for (const item of changes) {
    console.error(`check:protocol-compat: ${item.where}: ${item.what}.`);
  }
}

// Returns the exit code. The snapshot of a version only ever grows: a break is never written.
function run(): number {
  const text = readSnapshot();
  if (text === undefined) {
    if (isWrite) {
      writeSnapshot();
      console.log(`check:protocol-compat: wrote the snapshot of ${version} to ${snapshotFile}.`);
      return 0;
    }
    console.error(
      `check:protocol-compat: ${version} has no snapshot. Run pnpm check:protocol-compat --write ` +
        "and commit it.",
    );
    return 1;
  }
  const snapshot = snapshotSchema.parse(JSON.parse(text));
  if (snapshot.version !== current.version) {
    console.error(
      `check:protocol-compat: ${snapshotFile} holds version ${String(snapshot.version)}.`,
    );
    return 1;
  }
  const changes = compareSchemaSets(snapshot.schemas, current.schemas);
  const breaks = changes.filter((item) => item.kind !== "added");
  if (breaks.length > 0) {
    print(breaks);
    console.error(
      `check:protocol-compat: inside ${version} only additions are allowed. A removal or a ` +
        `change of meaning needs a new version: raise protocolVersion in ${versionFile}, then ` +
        "run pnpm check:protocol-compat --write.",
    );
    return 1;
  }
  if (text === currentText) {
    console.log(`check:protocol-compat: ${version} matches ${snapshotFile}.`);
    return 0;
  }
  if (isWrite) {
    writeSnapshot();
    console.log(
      `check:protocol-compat: recorded ${String(changes.length)} additions in ${snapshotFile}.`,
    );
    return 0;
  }
  print(changes);
  console.error(
    `check:protocol-compat: ${snapshotFile} is behind the schemas. Run ` +
      "pnpm check:protocol-compat --write and commit it.",
  );
  return 1;
}

process.exitCode = run();
