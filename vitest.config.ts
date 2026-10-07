import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  configDefaults,
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from "vitest/config";
import { z } from "zod";
import { sourceConditions } from "./config/vitest/source-conditions.js";

const defaultBar = 80;
// Amount math in core is money code: it meets the money bar that engine and chain meet.
const moneyBar = 95;
const moneyFolders = ["packages/core/src/amount/**"];

const graphSchema = z.looseObject({
  packages: z.record(z.string(), z.looseObject({ coverage: z.number().optional() })),
});

function packageFolders(): readonly string[] {
  return ["packages", "plugins"].flatMap((parent) =>
    existsSync(parent)
      ? readdirSync(parent, { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, "src")))
          .map((entry) => `${parent}/${entry.name}`)
      : [],
  );
}

// Fork tests need anvil and the network: they run in the fork suite (vitest.fork.config.ts).
const forkFolders = "**/src/fork/**";

// Platform tests mock native modules and its native suites need the real ones, so each of its
// files gets a fresh module graph.
const isolatedFolders = new Set(["packages/platform"]);

// Two projects, split by isolation: every project starts its own workers and module graph, which
// cost more than the tests themselves when each package was a project.
function project(
  name: "shared" | "isolated",
  members: readonly string[],
): TestProjectInlineConfiguration {
  return {
    extends: true,
    test: {
      name,
      include: members.map((folder) => `${folder}/src/**/*.test.ts`),
      exclude: [...configDefaults.exclude, forkFolders],
      isolate: name === "isolated",
    },
  };
}

function projects(): readonly TestProjectInlineConfiguration[] {
  const isolated = folders.filter((folder) => isolatedFolders.has(folder));
  const shared = folders.filter((folder) => !isolatedFolders.has(folder));
  return [
    ...(shared.length === 0 ? [] : [project("shared", shared)]),
    ...(isolated.length === 0 ? [] : [project("isolated", isolated)]),
  ];
}

interface Bar {
  readonly lines: number;
  readonly branches: number;
}

// Packages with their own bar in config/package-graph.json, and the money folders of other
// packages; the rest meet the default.
function tierThresholds(): Record<string, Bar> {
  const graph = graphSchema.parse(JSON.parse(readFileSync("config/package-graph.json", "utf8")));
  const packageBars = Object.entries(graph.packages)
    .filter(([, row]) => row.coverage !== undefined && row.coverage !== defaultBar)
    .map(([key, row]): [string, Bar] => [
      `packages/${key}/src/**`,
      { lines: row.coverage ?? defaultBar, branches: row.coverage ?? defaultBar },
    ]);
  const folderBars = moneyFolders.map((glob): [string, Bar] => [
    glob,
    { lines: moneyBar, branches: moneyBar },
  ]);
  return Object.fromEntries([...packageBars, ...folderBars]);
}

const folders = packageFolders();

const config: ViteUserConfig = defineConfig({
  resolve: { conditions: [...sourceConditions] },
  ssr: { resolve: { conditions: [...sourceConditions] } },
  test: {
    // Vitest refuses an empty project list; until a package exists the root runs alone. The
    // include stays out of the root once projects exist, or every project inherits it.
    ...(folders.length === 0
      ? { include: ["packages/*/src/**/*.test.ts", "plugins/*/src/**/*.test.ts"] }
      : { projects: [...projects()] }),
    passWithNoTests: true,
    // Files share their worker's modules, as Vitest's performance guide advises for tests that
    // clean up: importing every file's modules anew took half the run. Source keeps no
    // module-level state (docs/ENGINEERING.md), and stubbed variables come back after each test.
    isolate: false,
    unstubEnvs: true,
    unstubGlobals: true,
    // A timeout catches a hang, not a busy machine: unit tests run on fake timers, and a property
    // test of 0.4 s passed Vitest's 5 s default while other work held the CPU.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    setupFiles: ["config/vitest/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "plugins/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", forkFolders],
      reporter: ["text", "json-summary"],
      thresholds: { lines: defaultBar, branches: defaultBar, ...tierThresholds() },
    },
  },
});

export default config;
