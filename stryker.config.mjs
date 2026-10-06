import { existsSync, readFileSync } from "node:fs";

// Rows of config/package-graph.json marked "mutation" that exist on disk.
const graph = JSON.parse(readFileSync("config/package-graph.json", "utf8"));
const folders = Object.entries(graph.packages)
  .filter(([key, row]) => row.mutation === true && existsSync(`packages/${key}/src`))
  .map(([key]) => `packages/${key}`);

// Stryker's Vitest runner predates Vitest 5, so its command runner drives Vitest: each mutant
// runs the tests of the mutated packages with the mutant switched on.
const config = {
  testRunner: "command",
  commandRunner: { command: ["node node_modules/vitest/vitest.mjs run", ...folders].join(" ") },
  mutate: [...folders.map((folder) => `${folder}/src/**/*.ts`), "!**/*.test.ts"],
  coverageAnalysis: "off",
  reporters: ["clear-text", "progress", "html", "json"],
  thresholds: { high: 90, low: 80, break: 80 },
  tempDirName: ".stryker-tmp",
  // Stryker rewrites the sandbox tsconfig through TypeScript's JS API, which TypeScript 7 does
  // not ship. A file name that does not exist skips that step; Vitest needs no rewrite.
  tsconfigFile: "stryker-no-tsconfig.json",
};

export default config;
