import { idSchema } from "@binference/core";
import { createManualClock, createSeededRandom } from "@binference/core/testing";
import type { BrowserRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createRunningTurns } from "../chat/running-turns.js";
import { createFakeBrowserDriver } from "../fakes/fake-browser-driver.js";
import { createMemoryFiles, memoryFilePlaces } from "../fakes/memory-files.js";
import type { MachineFiles } from "../files/ports.js";
import { expectOk, testAgent } from "../intents/test-intents.js";
import { testCall, testCallers } from "../operations/test-engine.js";
import { type BrowserSettings, createBrowserHandlers } from "./browser-handlers.js";

const page = "https://example.test/";
const runtime = testCallers.runtime;

function setUp(given: { readonly settings?: BrowserSettings; readonly files?: MachineFiles } = {}) {
  const turns = createRunningTurns();
  turns.startRuntime(idSchema("tok").parse(runtime.credential));
  const driver = createFakeBrowserDriver({
    pages: { [page]: { title: "Example", text: "The harbour." } },
    refused: ["http://10.0.0.1/"],
  });
  const files = given.files ?? createMemoryFiles();
  const settings = given.settings ?? { enabled: true, evaluate: true };
  const handler = createBrowserHandlers({
    browser: { driver, settings: () => settings },
    turns,
    files,
    clock: createManualClock(Date.UTC(2026, 10, 8, 12)),
    random: createSeededRandom(5),
  })["browser/run"];
  const run = async (request: BrowserRequest, caller = runtime) =>
    handler(testCall({ agent: testAgent, request }, caller));
  return { run, driver, files };
}

describe("the agent's browser", () => {
  it("navigates and answers the page's snapshot", async () => {
    const view = expectOk(await setUp().run({ action: "navigate", url: page }));
    expect(view.tab?.title).toBe("Example");
    expect(view.snapshot).toContain("[ref=e2]");
  });

  it("answers only the runtime the engine runs now", async () => {
    const test = setUp();
    await expect(test.run({ action: "status" }, testCallers.cli)).resolves.toStrictEqual({
      ok: false,
      error: "auth.scope",
    });
    expect(test.driver.requests).toStrictEqual([]);
  });

  it("is off while the owner turned it off", async () => {
    const test = setUp({ settings: { enabled: false, evaluate: true } });
    await expect(test.run({ action: "start" })).resolves.toStrictEqual({
      ok: false,
      error: "browser.off",
    });
    expect(test.driver.requests).toStrictEqual([]);
  });

  it("is off in an engine without a browser", async () => {
    const turns = createRunningTurns();
    turns.startRuntime(idSchema("tok").parse(runtime.credential));
    const handler = createBrowserHandlers({
      turns,
      clock: createManualClock(0),
      random: createSeededRandom(1),
    })["browser/run"];
    await expect(
      handler(testCall({ agent: testAgent, request: { action: "status" } }, runtime)),
    ).resolves.toStrictEqual({ ok: false, error: "browser.off" });
  });

  it("refuses a script before the driver hears of it while scripts are off", async () => {
    const test = setUp({ settings: { enabled: true, evaluate: false } });
    const act = { kind: "evaluate", fn: "() => document.title" } as const;
    await expect(test.run({ action: "act", act })).resolves.toStrictEqual({
      ok: false,
      error: "browser.evaluate_off",
    });
    expect(test.driver.requests).toStrictEqual([]);
  });

  it("answers a refused address with its code", async () => {
    await expect(
      setUp().run({ action: "navigate", url: "http://10.0.0.1/" }),
    ).resolves.toStrictEqual({ ok: false, error: "browser.address_refused" });
  });

  it("saves a screenshot under the workspace's media folder by date, and names its path", async () => {
    const test = setUp();
    const view = expectOk(await test.run({ action: "screenshot" }));
    const folder = `${memoryFilePlaces.workspace}/media/browser/2026-11-08/`;
    expect(view.file?.path.startsWith(folder)).toBe(true);
    expect(view.file?.path.endsWith(".png")).toBe(true);
    expect(view.file?.contentType).toBe("image/png");
    const signal = new AbortController().signal;
    const read = await test.files.read(String(view.file?.path), {
      signal,
      workspaceOnly: true,
      maxBytes: 100,
    });
    expect(read.ok).toBe(true);
  });

  it("saves a PDF with its own extension", async () => {
    const view = expectOk(await setUp().run({ action: "pdf" }));
    expect(view.file?.path.endsWith(".pdf")).toBe(true);
  });
});
