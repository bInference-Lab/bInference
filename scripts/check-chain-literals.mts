import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { loadGraph } from "./package-graph/graph.mjs";
import { runCommand } from "./run-command.mjs";

// CAIP-2 namespaces and chain names a pure package must never spell, before any chain data or
// plugin names more.
const knownNamespaces = ["eip155", "solana", "bip122", "cosmos", "polkadot", "starknet"];
const knownIds = ["bsc", "bnb", "opbnb", "evm"];

function folderNames(root: string, parent: string): readonly string[] {
  const folder = join(root, parent);
  return existsSync(folder)
    ? readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
}

// Each chain data file is named after its chain's key, and each plugin after its venue.
function registryIds(root: string): readonly string[] {
  const chainFiles = existsSync(join(root, "packages/chains/src"))
    ? readdirSync(join(root, "packages/chains/src"))
        .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts") && file !== "index.ts")
        .map((file) => file.replace(/\.ts$/, ""))
    : [];
  return [...new Set([...knownIds, ...chainFiles, ...folderNames(root, "plugins")])];
}

function pureFolders(root: string): readonly string[] {
  const graph = loadGraph(root);
  return Object.entries(graph.packages)
    .filter(([key, row]) => row.pure === true && existsSync(join(root, "packages", key, "src")))
    .map(([key]) => `packages/${key}/src`);
}

function lintConfig(root: string): string {
  return JSON.stringify({
    plugins: [],
    jsPlugins: [resolve(root, "config/oxlint/guards.mjs")],
    categories: { correctness: "off", suspicious: "off", perf: "off" },
    rules: {
      "guards/no-chain-literal": ["error", { namespaces: knownNamespaces, ids: registryIds(root) }],
    },
  });
}

const root = process.cwd();
const folders = pureFolders(root);
const scratch = mkdtempSync(join(tmpdir(), "binference-chain-literals-"));
try {
  const config = join(scratch, "oxlintrc.json");
  writeFileSync(config, lintConfig(root));
  const result = runCommand(
    [
      "node",
      join("node_modules", "oxlint", "bin", "oxlint"),
      "-c",
      config,
      "--ignore-pattern",
      "**/*.test.ts",
      "--format",
      "unix",
      ...folders,
    ],
    { cwd: root },
  );
  const findings = result.output
    .split("\n")
    .filter((line) => line.includes("guards(no-chain-literal)"))
    .map((line) => `check:chain-literals: ${line}`);
  for (const finding of findings) {
    console.error(finding);
  }
  if (findings.length === 0 && result.status === 0) {
    console.log(
      `check:chain-literals: ${String(folders.length)} pure packages hold no chain literal.`,
    );
  } else if (findings.length === 0) {
    console.error(result.output);
  }
  process.exitCode = findings.length === 0 && result.status === 0 ? 0 : 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
