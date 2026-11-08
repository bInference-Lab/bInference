import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { Platform } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { createClosers } from "./closers.js";
import { browserOf } from "./compose-browser.js";
import type { Opened, Opening } from "./open-engine-parts.js";

const signal = new AbortController().signal;

function setUp(given: { readonly browser?: object; readonly proxy?: boolean } = {}) {
  const config = configSchema.parse({
    version: currentConfigVersion,
    telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
    ...(given.browser === undefined ? {} : { browser: given.browser }),
  });
  const closers = createClosers();
  const platform = {
    stateFolder: { root: "/srv/binference", workspace: "/srv/binference/workspace" },
    hasDesktopSession: false,
    findBrowser: () => undefined,
  } as unknown as Platform;
  const opening = {
    host: { clock: createManualClock(0), homeDir: "/srv/owner" },
    platform,
    closers,
    signal,
  } as unknown as Opening;
  const proxy = given.proxy === true ? { proxy: "unread" as const, noProxy: [] } : { noProxy: [] };
  const opened = {
    settings: { current: () => config },
    proxy: { current: () => proxy },
    log: { logger: createMemoryLogger({ subsystem: "engine" }) },
  } as unknown as Opened;
  return { browser: browserOf(opening, opened), closers };
}

describe("the agent's browser as the engine gets it", () => {
  it("is on with scripts by default", () => {
    expect(setUp().browser.settings()).toStrictEqual({ enabled: true, evaluate: true });
  });

  it("follows the owner's switches", () => {
    const { browser } = setUp({ browser: { enabled: false, evaluate: false } });
    expect(browser.settings()).toStrictEqual({ enabled: false, evaluate: false });
  });

  it("refuses to start with no browser on the machine and none named", async () => {
    await expect(
      setUp().browser.driver.run({ action: "start" }, { signal }),
    ).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("refuses to start while the owner's proxy cannot be read", async () => {
    const { browser } = setUp({ proxy: true });
    await expect(browser.driver.run({ action: "start" }, { signal })).resolves.toStrictEqual({
      ok: false,
      error: "proxy_held",
    });
  });

  it("answers that it runs nothing before any call, and adds its closer", async () => {
    const { browser, closers } = setUp();
    await expect(browser.driver.run({ action: "status" }, { signal })).resolves.toStrictEqual({
      ok: true,
      value: { view: { running: false } },
    });
    await expect(closers.closeAll(signal)).resolves.toBeUndefined();
  });
});
