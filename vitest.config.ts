import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defineConfig,
  type TestProjectInlineConfiguration,
  type ViteUserConfig,
} from "vitest/config";
import { z } from "zod";

// Workspace packages export src under this condition, so tests never need a build first.
const sourceConditions = ["@binference/source", "module", "node", "development|production"];
const defaultBar = 80;

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

function project(folder: string): TestProjectInlineConfiguration {
  return { extends: true, test: { name: folder, include: [`${folder}/src/**/*.test.ts`] } };
}

// Packages with their own bar in config/package-graph.json; the rest meet the default.
function tierThresholds(): Record<string, { lines: number; branches: number }> {
  const graph = graphSchema.parse(JSON.parse(readFileSync("config/package-graph.json", "utf8")));
  return Object.fromEntries(
    Object.entries(graph.packages)
      .filter(([, row]) => row.coverage !== undefined && row.coverage !== defaultBar)
      .map(([key, row]) => [
        `packages/${key}/src/**`,
        { lines: row.coverage ?? defaultBar, branches: row.coverage ?? defaultBar },
      ]),
  );
}

const folders = packageFolders();

const config: ViteUserConfig = defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "plugins/*/src/**/*.test.ts"],
    // Vitest refuses an empty project list; until a package exists the root runs alone.
    ...(folders.length === 0 ? {} : { projects: folders.map(project) }),
    passWithNoTests: true,
    setupFiles: ["config/vitest/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts", "plugins/*/src/**/*.ts"],
      exclude: ["**/*.test.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: defaultBar, branches: defaultBar, ...tierThresholds() },
    },
  },
});

export default config;
