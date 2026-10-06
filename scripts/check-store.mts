import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { readAtBase } from "./git-base.mjs";
import { listRepoFiles } from "./repo-files.mjs";
import { runPluginRules } from "./run-plugin-rules.mjs";
import {
  migrationFolders,
  migrationProblems,
  type StoreProblem,
} from "./store/migration-files.mjs";
import {
  lockPath,
  lockProblems,
  migrationHashes,
  parseLock,
  withCurrentHashes,
} from "./store/migration-lock.mjs";

// Raw SQL is legal in migrations, the connection layer (opening pragmas, transactions,
// integrity checks, VACUUM INTO) and the copied dialect. The engine lock in platform takes an OS
// file lock through one node:sqlite statement on the main thread (ENGINEERING.md 2.6).
const rawSqlAllowed = [
  "packages/store/src/migrations/",
  "packages/store/src/sqlite/",
  "packages/store/src/dialect/",
  "packages/platform/src/file-lock.ts",
];
const sqliteAllowed = ["packages/platform/src/file-lock.ts"];

function sourceFolders(files: readonly string[]): readonly string[] {
  const folders = new Set(
    files
      .map((file) => /^((?:packages|plugins)\/[^/]+\/src)\//.exec(file)?.[1])
      .filter((folder) => folder !== undefined),
  );
  return [...folders].toSorted();
}

function storeRules(root: string): Readonly<Record<string, readonly [string, object]>> {
  const base = { root: resolve(root) };
  return {
    "store/raw-sql": ["error", { ...base, allow: rawSqlAllowed }],
    "store/sync-transaction": ["error", base],
    "store/ledger-append-only": ["error", base],
    "store/intent-state-writer": ["error", base],
    "store/sqlite-in-worker": ["error", { ...base, allow: sqliteAllowed }],
    "store/no-migration-down": ["error", base],
  };
}

// One file may write intents.state: the state machine's store adapter. Every write in a second
// file is a finding.
function intentWriterProblems(lines: readonly string[]): readonly string[] {
  const writes = lines.filter((line) => line.includes("store(intent-state-writer)"));
  const files = new Set(writes.map((line) => line.split(":")[0]));
  return files.size > 1
    ? writes.map((line) =>
        line.replace(
          "This file writes intents.state.",
          `${String(files.size)} files write intents.state; only the intent state machine's store adapter may.`,
        ),
      )
    : [];
}

function lintFindings(root: string, folders: readonly string[]): readonly string[] {
  const result = runPluginRules(root, {
    plugin: "config/oxlint/store-guards.mjs",
    rules: storeRules(root),
    folders,
  });
  const lines = result.output.split("\n").filter((line) => line.includes("store("));
  const findings = [
    ...lines.filter((line) => !line.includes("store(intent-state-writer)")),
    ...intentWriterProblems(lines),
  ];
  // Oxlint fails on the one allowed writer of intents.state too; its output is a finding only when
  // no store rule explains the failure, such as a crash.
  return findings.length === 0 && result.status !== 0 && lines.length === 0
    ? [result.output.trim()]
    : findings;
}

function migrationLockProblems(
  root: string,
  files: readonly string[],
  mode: "write" | "check",
): readonly StoreProblem[] {
  const folders = migrationFolders(files);
  const hashes = migrationHashes(root, folders);
  const base = parseLock(readAtBase(root, lockPath));
  if (mode === "write") {
    writeFileSync(
      join(root, lockPath),
      `${JSON.stringify(withCurrentHashes(hashes, base), null, 2)}\n`,
    );
  }
  const lockFile = join(root, lockPath);
  const lock = parseLock(existsSync(lockFile) ? readFileSync(lockFile, "utf8") : undefined);
  return [...migrationProblems(root, folders), ...lockProblems(hashes, lock, base)];
}

const root = process.cwd();
const files = listRepoFiles(root);
const folders = sourceFolders(files);
const findings = [
  ...lintFindings(root, folders),
  ...migrationLockProblems(root, files, process.argv.includes("--write") ? "write" : "check").map(
    (problem) => `${problem.where}: ${problem.message}`,
  ),
];
for (const finding of findings) {
  console.error(`check:store: ${finding}`);
}
if (findings.length === 0) {
  console.log(`check:store: ${String(folders.length)} source folders follow the store rules.`);
}
process.exitCode = findings.length === 0 ? 0 : 1;
