import { createManualClock } from "@binference/core/testing";
import { browserDriverContract, createFakeBrowserDriver } from "@binference/engine/testing";
import { describe, expect, it } from "vitest";
import { browserIdleMs, withIdleStop } from "./idle-stop.js";

const page = {
  url: "https://example.test/",
  title: "Example",
  word: "harbour",
  clickedTitle: "Pressed",
};
const signal = new AbortController().signal;

function setUp() {
  const clock = createManualClock(0);
  const inner = createFakeBrowserDriver({
    pages: {
      [page.url]: { title: page.title, text: "The harbour.", clickedTitle: page.clickedTitle },
    },
    refused: ["http://10.0.0.1/"],
  });
  return { clock, driver: withIdleStop(inner, { clock, idleMs: browserIdleMs }) };
}

describe("a browser that stops when idle", () => {
  it.each(
    browserDriverContract({
      create: async () =>
        Promise.resolve({ driver: setUp().driver, page, refusedUrl: "http://10.0.0.1/" }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("stops after 10 minutes without a call", async () => {
    const { clock, driver } = setUp();
    await driver.run({ action: "start" }, { signal });
    await clock.advance(browserIdleMs - 1);
    expect(driver.isRunning()).toBe(true);
    await clock.advance(1);
    expect(driver.isRunning()).toBe(false);
  });

  it("counts the 10 minutes again from each call", async () => {
    const { clock, driver } = setUp();
    await driver.run({ action: "start" }, { signal });
    await clock.advance(browserIdleMs - 1_000);
    await driver.run({ action: "tabs" }, { signal });
    await clock.advance(browserIdleMs - 1_000);
    expect(driver.isRunning()).toBe(true);
    await clock.advance(1_000);
    expect(driver.isRunning()).toBe(false);
  });

  it("keeps no timer once stopped", async () => {
    const { clock, driver } = setUp();
    await driver.run({ action: "start" }, { signal });
    await driver.stop();
    await driver.run({ action: "status" }, { signal });
    await clock.advance(browserIdleMs);
    expect(driver.isRunning()).toBe(false);
  });
});
