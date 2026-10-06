import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  findPackages,
  graphPath,
  loadGraph,
  packageName,
  type PackageGraph,
  type PackageRow,
  type WorkspacePackage,
} from "./package-graph/graph.mjs";
import { buildLintConfig, lintConfigPath, renderLintConfig } from "./package-graph/lint-config.mjs";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function dependencyNames(item: WorkspacePackage): readonly string[] {
  return dependencyFields.flatMap((field) => {
    const value = item.manifest[field];
    return typeof value === "object" && value !== null ? Object.keys(value) : [];
  });
}

// @types/foo and @types/scope__foo describe foo and @scope/foo.
function typedLibrary(name: string): string {
  const typed = name.replace(/^@types\//, "");
  return typed.includes("__") ? `@${typed.replace("__", "/")}` : typed;
}

function rowFor(graph: PackageGraph, item: WorkspacePackage): PackageRow | undefined {
  return item.key === "plugins" ? graph.plugins : graph.packages[item.key];
}

function dependencyProblems(
  graph: PackageGraph,
  item: WorkspacePackage,
  row: PackageRow,
): string[] {
  if (row.imports.includes("*")) {
    return [];
  }
  const keyByName = new Map(
    Object.keys(graph.packages).map((key) => [packageName(graph, key), key]),
  );
  const allowed = new Set([...row.imports, ...graph.allowEverywhere]);
  const anyThirdParty = item.key === "plugins" && graph.plugins.anyThirdParty === true;
  return dependencyNames(item)
    .filter((name) => {
      const key = keyByName.get(name);
      if (key !== undefined) {
        return !allowed.has(key);
      }
      return !anyThirdParty && !allowed.has(typedLibrary(name));
    })
    .map(
      (name) => `${item.folder} depends on ${name}, which its row in ${graphPath} does not list.`,
    );
}

function manifestProblems(graph: PackageGraph, item: WorkspacePackage): string[] {
  const row = rowFor(graph, item);
  if (row === undefined) {
    return [`${item.folder} has no row in ${graphPath}; add one before the package.`];
  }
  const name = item.manifest["name"];
  const expected = item.key === "plugins" ? undefined : packageName(graph, item.key);
  const problems: string[] = [];
  if (expected !== undefined && name !== expected) {
    problems.push(`${item.folder} must be named ${expected}.`);
  }
  if (row.publish !== true && item.manifest["private"] !== true) {
    problems.push(`${item.folder} is not published, so its package.json sets "private": true.`);
  }
  return [...problems, ...dependencyProblems(graph, item, row)];
}

function versionProblems(graph: PackageGraph, packages: readonly WorkspacePackage[]): string[] {
  const published = packages.filter((item) => rowFor(graph, item)?.publish === true);
  const versions = new Set(published.map((item) => String(item.manifest["version"])));
  return versions.size > 1
    ? [`Published packages share one version; found ${[...versions].join(", ")}.`]
    : [];
}

function lintConfigProblems(repo: string, expected: string): string[] {
  const file = join(repo, lintConfigPath);
  if (!existsSync(file) || readFileSync(file, "utf8") !== expected) {
    return [
      `${lintConfigPath} does not match ${graphPath}. It is generated: edit the graph, then run ` +
        "pnpm check:package-graph --write.",
    ];
  }
  return [];
}

const repo = process.cwd();
const graph = loadGraph(repo);
const packages = findPackages(repo);
const lintConfig = renderLintConfig(buildLintConfig(graph, packages));
if (process.argv.includes("--write")) {
  writeFileSync(join(repo, lintConfigPath), lintConfig);
}
const problems = [
  ...packages.flatMap((item) => manifestProblems(graph, item)),
  ...versionProblems(graph, packages),
  ...lintConfigProblems(repo, lintConfig),
];
for (const problem of problems) {
  console.error(`check:package-graph: ${problem}`);
}
if (problems.length === 0) {
  console.log(`check:package-graph: ${String(packages.length)} packages match ${graphPath}.`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
