import { defineConfig, type ViteUserConfig } from "vitest/config";
import { sourceResolution } from "./config/vitest/source-resolution.js";

// The image smoke test: the tests in each package's src/image/, which build the Docker image, set
// it up, trade on paper and stop it, then remove what they made. They need Docker and the
// network, so pnpm check never runs them; `pnpm test:image` does, one heavy job at a time.
const config: ViteUserConfig = defineConfig({
  ...sourceResolution,
  test: {
    include: ["packages/*/src/image/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 900_000,
  },
});

export default config;
