import { defineConfig, type ViteUserConfig } from "vitest/config";
import root from "./vitest.config.js";

// One shard of CI's test run (decision 0454): the root config with no coverage bars, since a
// shard covers the code its own third of the files reach and Vitest checks the bars in each run.
// The job that merges the shards' blob reports runs the root config, so every bar of `pnpm test`
// holds on the whole run.
const config: ViteUserConfig = defineConfig({
  ...root,
  test: { ...root.test, coverage: { ...root.test?.coverage, thresholds: {} } },
});

export default config;
