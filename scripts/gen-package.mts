import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { findPackages, graphPath, loadGraph, packageName } from "./package-graph/graph.mjs";
import { buildLintConfig, lintConfigPath, renderLintConfig } from "./package-graph/lint-config.mjs";
import { runCommand } from "./run-command.mjs";

interface PackageSpec {
  readonly name: string;
  readonly description: string;
  /** The npm name: the graph row's \`name\`, or \`<scope>/<folder>\`. */
  readonly npmName: string;
}

const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const defaultDescription = "Describe what this package holds in one sentence.";

function readSpec(args: readonly string[]): PackageSpec {
  const [name, description] = args;
  if (name === undefined || !namePattern.test(name)) {
    throw new Error("Usage: pnpm gen:package <kebab-case-name> [description]");
  }
  const npmName = packageName(loadGraph(process.cwd()), name);
  return { name, description: description ?? defaultDescription, npmName };
}

function manifest(spec: PackageSpec): string {
  const content = {
    name: spec.npmName,
    version: "0.0.0",
    private: true,
    description: spec.description,
    license: "MIT",
    type: "module",
    files: ["dist"],
    exports: {
      ".": {
        "@binference/source": "./src/index.ts",
        types: "./dist/index.d.mts",
        default: "./dist/index.mjs",
      },
    },
    scripts: { build: "tsdown src/index.ts --format esm --dts --tsconfig tsconfig.json" },
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

function tsconfig(): string {
  const content = {
    extends: "../../tsconfig.base.json",
    compilerOptions: { rootDir: "src" },
    include: ["src"],
    exclude: ["src/**/*.test.ts"],
  };
  return `${JSON.stringify(content, null, 2)}\n`;
}

function agentRules(spec: PackageSpec): string {
  return [
    `# ${spec.npmName}`,
    "",
    spec.description,
    "",
    "The root [AGENTS.md](../../AGENTS.md) applies here. Rules for this package:",
    "",
    "- Its public API is what `src/index.ts` exports; every export carries TSDoc.",
    "- Tests sit beside the code as `*.test.ts`.",
    "",
  ].join("\n");
}

function readme(spec: PackageSpec): string {
  return [
    `# ${spec.npmName}`,
    "",
    "## Purpose",
    "",
    spec.description,
    "",
    "## API",
    "",
    "| Export        | What it does                              |",
    "| ------------- | ----------------------------------------- |",
    "| `packageName` | The package's name, as its manifest says. |",
    "",
    "## Example",
    "",
    "```ts",
    `import { packageName } from "${spec.npmName}";`,
    "```",
    "",
  ].join("\n");
}

function entry(spec: PackageSpec): string {
  return [
    "/** The package's name, as its manifest declares it. */",
    `export const packageName: string = "${spec.npmName}";`,
    "",
  ].join("\n");
}

function entryTest(spec: PackageSpec): string {
  return [
    'import { describe, expect, it } from "vitest";',
    'import { packageName } from "./index.js";',
    "",
    'describe("packageName", () => {',
    '  it("matches the name its manifest declares", () => {',
    `    expect(packageName).toBe("${spec.npmName}");`,
    "  });",
    "});",
    "",
  ].join("\n");
}

// A new package starts with no imports beyond those every package may use; its author widens
// the row in the graph, and the generated lint rules follow.
function addGraphRow(repo: string, name: string): readonly string[] {
  const graph = loadGraph(repo);
  if (graph.packages[name] === undefined) {
    const packages = { ...graph.packages, [name]: { imports: [] } };
    writeFileSync(join(repo, graphPath), `${JSON.stringify({ ...graph, packages }, null, 2)}\n`);
  }
  const lintConfig = buildLintConfig(loadGraph(repo), findPackages(repo));
  writeFileSync(join(repo, lintConfigPath), renderLintConfig(lintConfig));
  return [graphPath];
}

function format(repo: string, files: readonly string[]): void {
  const result = runCommand(["node", join("node_modules", "oxfmt", "bin", "oxfmt"), ...files], {
    cwd: repo,
  });
  if (result.status !== 0) {
    throw new Error(`oxfmt failed on the new files:\n${result.output}`);
  }
}

function generate(spec: PackageSpec): string {
  const root = join("packages", spec.name);
  if (existsSync(root)) {
    throw new Error(`${root} already exists.`);
  }
  mkdirSync(join(root, "src"), { recursive: true });
  const files: Readonly<Record<string, string>> = {
    "package.json": manifest(spec),
    "tsconfig.json": tsconfig(),
    "AGENTS.md": agentRules(spec),
    "CLAUDE.md": "@AGENTS.md\n",
    "README.md": readme(spec),
    "src/index.ts": entry(spec),
    "src/index.test.ts": entryTest(spec),
  };
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(root, file), content);
  }
  const repo = process.cwd();
  format(repo, [root, ...addGraphRow(repo, spec.name)]);
  return root;
}

const root = generate(readSpec(process.argv.slice(2)));
console.log(
  `Created ${root} and its row in ${graphPath}. Run pnpm install to link it, then write its ` +
    "README, its AGENTS.md and the imports its row allows.",
);
