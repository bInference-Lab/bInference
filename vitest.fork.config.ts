import { defineConfig, type ViteUserConfig } from "vitest/config";
import { sourceConditions } from "./config/vitest/source-conditions.js";

// The fork suite: the tests in each package's src/fork/, against the one anvil fork of BSC that
// the global setup starts. pnpm check never runs it; `pnpm test:fork` and the nightly job do.
const config: ViteUserConfig = defineConfig({
  resolve: { conditions: [...sourceConditions] },
  ssr: { resolve: { conditions: [...sourceConditions] } },
  test: {
    include: ["packages/*/src/fork/**/*.test.ts", "plugins/*/src/fork/**/*.test.ts"],
    globalSetup: ["config/vitest/fork-setup.ts"],
    // Every test returns the shared fork to its snapshot when it ends, so files take turns.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

export default config;
