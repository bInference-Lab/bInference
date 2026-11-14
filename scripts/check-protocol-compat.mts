import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { describeProtocol } from "@binference/protocol";
import { unservedOperations } from "binference";
import { z } from "zod";
import { compareSchemaSets, type SchemaChange } from "./protocol-compat/compare-schemas.mjs";
import { judgeScopes } from "./protocol-compat/narrowed-scopes.mjs";

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
// The rows the engine leaves unserved as not built, whose scope may narrow inside a version.
const notBuilt = new Set(
  [...unservedOperations].flatMap(([name, reason]) => (reason.kind === "not_built" ? [name] : [])),
);

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

// The first run of a version writes its snapshot, with --write.
function firstSnapshot(): number {
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

// The changes past the snapshot, with any break and why: a break is never written.
function changesSince(snapshotText: string): readonly SchemaChange[] | undefined {
  const snapshot = snapshotSchema.parse(JSON.parse(snapshotText));
  if (snapshot.version !== current.version) {
    console.error(
      `check:protocol-compat: ${snapshotFile} holds version ${String(snapshot.version)}.`,
    );
    return undefined;
  }
  const schemas = { before: snapshot.schemas, after: current.schemas };
  const verdict = judgeScopes(compareSchemaSets(schemas.before, schemas.after), schemas, notBuilt);
  const breaks = verdict.changes.filter(({ kind }) => kind !== "added" && kind !== "narrowed");
  if (breaks.length === 0) {
    return verdict.changes;
  }
  print(breaks);
  verdict.reasons.forEach((reason) => console.error(`check:protocol-compat: ${reason}.`));
  console.error(
    `check:protocol-compat: inside ${version} only additions are allowed, and a narrower scope ` +
      "on a row the engine leaves unserved as not built. A removal or a change of meaning needs " +
      `a new version: raise protocolVersion in ${versionFile}, then run pnpm ` +
      "check:protocol-compat --write.",
  );
  return undefined;
}

// Returns the exit code. The snapshot of a version only ever grows: a break is never written.
function run(): number {
  const text = readSnapshot();
  if (text === undefined) {
    return firstSnapshot();
  }
  const changes = changesSince(text);
  if (changes === undefined) {
    return 1;
  }
  if (text === currentText) {
    console.log(`check:protocol-compat: ${version} matches ${snapshotFile}.`);
    return 0;
  }
  if (isWrite) {
    writeSnapshot();
    const count = String(changes.length);
    console.log(`check:protocol-compat: recorded ${count} changes that pass in ${snapshotFile}.`);
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
