import { defineConfig } from "@playwright/test";

// The engine of the smoke test listens here, and its control listener beside it; both on
// loopback, taken only while the test runs. Paths are from this folder, where Playwright runs the
// engine's command.
const enginePort = 7491;
const controlPort = 7492;

/**
 * The console's smoke test (`pnpm test:console`): headless Chromium only, one worker, against the
 * skeleton's engine on loopback serving the built console. It never opens a window.
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "../../smoke-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  reporter: "line",
  use: {
    browserName: "chromium",
    headless: true,
    baseURL: `http://127.0.0.1:${String(enginePort)}`,
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  webServer: {
    command:
      "node --conditions=@binference/source --import tsx ../../../cli/src/console-smoke/smoke-engine.ts",
    url: `http://127.0.0.1:${String(controlPort)}/ready`,
    env: {
      SMOKE_PORT: String(enginePort),
      SMOKE_CONTROL_PORT: String(controlPort),
      SMOKE_CONSOLE: "../../dist",
    },
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
