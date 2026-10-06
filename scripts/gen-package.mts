import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

interface PackageSpec {
  readonly name: string;
  readonly description: string;
}

const namePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const defaultDescription = "Describe what this package holds in one sentence.";

function readSpec(args: readonly string[]): PackageSpec {
  const [name, description] = args;
  if (name === undefined || !namePattern.test(name)) {
    throw new Error("Usage: pnpm gen:package <kebab-case-name> [description]");
  }
  return { name, description: description ?? defaultDescription };
}

function manifest(spec: PackageSpec): string {
  const content = {
    name: `@binference/${spec.name}`,
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
    `# @binference/${spec.name}`,
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
    `# @binference/${spec.name}`,
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
    `import { packageName } from "@binference/${spec.name}";`,
    "```",
    "",
  ].join("\n");
}

function entry(spec: PackageSpec): string {
  return [
    "/** The package's name, as its manifest declares it. */",
    `export const packageName: string = "@binference/${spec.name}";`,
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
    `    expect(packageName).toBe("@binference/${spec.name}");`,
    "  });",
    "});",
    "",
  ].join("\n");
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
  return root;
}

const root = generate(readSpec(process.argv.slice(2)));
console.log(`Created ${root}. Run pnpm install to link it, then write its README and AGENTS.md.`);
