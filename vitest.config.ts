import { defineConfig, type ViteUserConfig } from "vitest/config";

// Workspace packages export src under this condition, so tests never need a build first.
const sourceConditions = ["@binference/source", "module", "node", "development|production"];

const config: ViteUserConfig = defineConfig({
  resolve: { conditions: sourceConditions },
  ssr: { resolve: { conditions: sourceConditions } },
  test: {
    include: ["packages/*/src/**/*.test.ts", "plugins/*/src/**/*.test.ts"],
    passWithNoTests: true,
  },
});

export default config;
