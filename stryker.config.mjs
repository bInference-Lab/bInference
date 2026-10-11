import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import process from "node:process";

// Rows of config/package-graph.json marked "mutation" that exist on disk.
const graph = JSON.parse(readFileSync("config/package-graph.json", "utf8"));
// MUTATE_PACKAGES (comma-separated keys) narrows the run, so one package can be mutated alone.
const only = (process.env.MUTATE_PACKAGES ?? "").split(",").filter((key) => key.length > 0);
const folders = Object.entries(graph.packages)
  .filter(([key, row]) => row.mutation === true && existsSync(`packages/${key}/src`))
  .filter(([key]) => only.length === 0 || only.includes(key))
  .map(([key]) => `packages/${key}`);

// MUTATE_SHARD ("2/16") mutates one shard of the source files. A file's shard comes from a hash
// of its path, so adding a file never moves another to a different shard and its results.
const shard = /^(\d+)\/(\d+)$/.exec(process.env.MUTATE_SHARD ?? "");
const [index, count] = shard === null ? [1, 1] : [Number(shard[1]), Number(shard[2])];
if (count < 1 || index < 1 || index > count) {
  throw new Error(`MUTATE_SHARD must be k/n with 1 <= k <= n, not ${process.env.MUTATE_SHARD}.`);
}

function hashOf(text) {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  }
  return hash;
}

// MUTATE_FILES (comma-separated paths) narrows the run to those files: a pull request mutates only
// the source files it changes.
const changed = new Set(
  (process.env.MUTATE_FILES ?? "").split(",").filter((path) => path.length > 0),
);

const files = folders
  .flatMap((folder) =>
    readdirSync(`${folder}/src`, { recursive: true, encoding: "utf8" })
      .map((path) => `${folder}/src/${path.replaceAll("\\", "/")}`)
      .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts")),
  )
  .filter((path) => changed.size === 0 || changed.has(path))
  .filter((path) => count === 1 || hashOf(path) % count === index - 1)
  .toSorted();
if (files.length === 0) {
  throw new Error(`Shard ${index} of ${count} holds no source file to mutate; use fewer shards.`);
}
const tested = folders.filter((folder) => files.some((path) => path.startsWith(`${folder}/`)));

// Each test runner process runs Vitest on two workers. Four runners of Vitest's default workers on
// a four-core runner made every run slower than the timeout, so every mutant "timed out".
const runners = Math.max(1, Math.floor(availableParallelism() / 2));

// Stryker's Vitest runner predates Vitest 5, so its command runner drives Vitest: each mutant
// runs the tests of the mutated packages with the mutant switched on, and stops at the first
// failure, which already kills it.
const vitest = "node node_modules/vitest/vitest.mjs run --bail=1 --maxWorkers=2";
const config = {
  testRunner: "command",
  commandRunner: { command: [vitest, ...tested].join(" ") },
  mutate: files,
  coverageAnalysis: "off",
  concurrency: runners,
  // A run under load takes about twice the initial run; 30 s on top is still far below a hang.
  timeoutMS: 30_000,
  reporters: ["clear-text", "progress", "html", "json"],
  thresholds: { high: 90, low: 80, break: 80 },
  incrementalFile:
    count === 1
      ? "reports/stryker-incremental.json"
      : `reports/stryker-incremental-${index}-of-${count}.json`,
  tempDirName: ".stryker-tmp",
  // Stryker rewrites the sandbox tsconfig through TypeScript's JS API, which TypeScript 7 does
  // not ship. A file name that does not exist skips that step; Vitest needs no rewrite.
  tsconfigFile: "stryker-no-tsconfig.json",
};

export default config;
