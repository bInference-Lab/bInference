import { configDefaults, defineConfig, type ViteUserConfig } from "vitest/config";
import { sourceResolution } from "./config/vitest/source-resolution.js";

// The fork suite: the tests in each package's src/fork/, against the one anvil fork of BSC that
// the global setup starts and each file's setup pins again at a recent block. pnpm check never
// runs it; `pnpm test:fork` and the nightly job do. The replays there (`*.replay.test.ts`) run
// for minutes, so they have a suite of their own (vitest.replay.config.ts).
const config: ViteUserConfig = defineConfig({
  ...sourceResolution,
  test: {
    include: ["packages/*/src/fork/**/*.test.ts", "plugins/*/src/fork/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.replay.test.ts"],
    globalSetup: ["config/vitest/fork-setup.ts"],
    setupFiles: ["config/vitest/fork-file-setup.ts"],
    // Every test returns the shared fork to its snapshot when it ends, so files take turns.
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

export default config;
