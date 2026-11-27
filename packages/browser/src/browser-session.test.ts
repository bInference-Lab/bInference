import { startNodeProgram } from "@binference/platform";
import { describe, expect, it } from "vitest";

// Runs in a Node of its own, so the test's own loader cannot hide a module load: it records each
// time `playwright-core` is resolved, builds a driver and reads its status, then starts it on a
// program that is not there.
const script = `
import { registerHooks } from "node:module";
const loads = [];
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "playwright-core") loads.push(specifier);
    return next(specifier, context);
  },
});
const { createBrowserDriver } = await import("@binference/browser");
const { createMemoryLogger } = await import("@binference/core/testing");
const driver = createBrowserDriver({
  launch: () => ({ headless: true }),
  findBrowser: () => "/no/such/browser",
  userDataFolder: "/no/such/profile",
  route: () => ({ kind: "direct" }),
  guard: {},
  logger: createMemoryLogger({ subsystem: "browser" }),
});
const signal = new AbortController().signal;
await driver.run({ action: "status" }, { signal });
const beforeStart = loads.length;
const start = await driver.run({ action: "start" }, { signal });
console.log(JSON.stringify({ beforeStart, afterStart: loads.length, start: start.ok ? "ok" : start.error }));
`;

async function lastLine(): Promise<string> {
  const program = startNodeProgram({
    args: [
      "--conditions=@binference/source",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    parentEnv: {},
    cwd: import.meta.dirname,
    signal: AbortSignal.timeout(60_000),
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of program.output) {
    chunks.push(chunk);
  }
  await program.exited;
  return Buffer.concat(chunks).toString("utf8").trim().split("\n").at(-1) ?? "";
}

describe("the browser session", () => {
  it("loads Playwright at the browser's first start, never with the engine", async () => {
    expect(JSON.parse(await lastLine())).toEqual({
      beforeStart: 0,
      afterStart: 1,
      start: "start_failed",
    });
  });
});
