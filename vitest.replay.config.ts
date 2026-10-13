import { defineConfig, type ViteUserConfig } from "vitest/config";
import { sourceResolution } from "./config/vitest/source-resolution.js";

// The replay suite: the `*.replay.test.ts` files in each package's src/fork/, which drive today's
// pools on the fork suite's anvil fork along a recorded day of prices, block by block at the
// chain's pace. A replay runs for minutes, past a fork file's budget, so neither pnpm check nor
// `pnpm test:fork` runs it; `pnpm test:replay` and the nightly fork job do.
const config: ViteUserConfig = defineConfig({
  ...sourceResolution,
  test: {
    include: ["packages/*/src/fork/**/*.replay.test.ts"],
    globalSetup: ["config/vitest/fork-setup.ts"],
    setupFiles: ["config/vitest/replay-test-setup.ts"],
    // Every replay mines the one shared fork and is timed against the wall clock, so files take
    // turns.
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});

export default config;
