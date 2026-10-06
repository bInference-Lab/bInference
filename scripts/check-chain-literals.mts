import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { loadGraph } from "./package-graph/graph.mjs";
import { runPluginRules } from "./run-plugin-rules.mjs";

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

const root = process.cwd();
const folders = pureFolders(root);
const result = runPluginRules(root, {
  plugin: "config/oxlint/guards.mjs",
  rules: {
    "guards/no-chain-literal": ["error", { namespaces: knownNamespaces, ids: registryIds(root) }],
  },
  folders,
});
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
