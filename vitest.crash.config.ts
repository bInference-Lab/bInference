import { defineConfig, type ViteUserConfig } from "vitest/config";
import { sourceResolution } from "./config/vitest/source-resolution.js";

// The crash suite: the tests in each package's src/crash/, which kill an engine process at a point
// of the money path and start it again, against the anvil chain the global setup starts. pnpm
// check never runs it; `pnpm test:crash` and the nightly job on three OSes do.
const config: ViteUserConfig = defineConfig({
  ...sourceResolution,
  test: {
    include: ["packages/*/src/crash/**/*.test.ts"],
    globalSetup: ["config/vitest/crash-setup.ts"],
    // Every run mines the one chain and counts what reaches it, so runs take turns.
    fileParallelism: false,
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});

export default config;
