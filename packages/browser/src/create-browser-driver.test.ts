import assert from "node:assert/strict";
import { lookup } from "node:dns";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryLogger } from "@binference/core/testing";
import type { BrowserDriver, BrowserOutcome } from "@binference/engine/browser";
import { browserDriverContract } from "@binference/engine/testing";
import { createPlatform, realFilePath } from "@binference/platform";
import type { BrowserRequest } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAddressGuard } from "./address-guard.js";
import { createBrowserDriver } from "./create-browser-driver.js";

const program = createPlatform().findBrowser();

const html = `<!doctype html><html><head><title>Harbour</title></head><body>
<main><h1>Harbour</h1><p>Boats rest in the harbour.</p>
<label>Name <input id="name" /></label>
<button onclick="document.title = 'Pressed'">Press</button></main></body></html>`;

// A loopback server that answers every request with one page, as a test's static site.
async function serve(body: string): Promise<{ readonly server: Server; readonly origin: string }> {
  const server = createServer((socket) => {
    socket.once("data", () => {
      const head = `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${String(Buffer.byteLength(body))}\r\nConnection: close\r\n\r\n`;
      socket.end(head + body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, origin: `http://127.0.0.1:${String(port)}` };
}

const places = { folder: "", origin: "", engineOrigin: "" };
const servers: Server[] = [];

function driverOf() {
  const enginePort = Number(new URL(places.engineOrigin).port);
  const guard = createAddressGuard({
    allowPrivateNetwork: () => false,
    enginePorts: () => [enginePort],
    publicOrigin: () => undefined,
    walled: { roots: [join(places.folder, "state")], open: [] },
    lookup,
    realPath: async (path) => realFilePath(path, AbortSignal.timeout(1_000)).catch(() => undefined),
    allowedOrigins: [places.origin],
  });
  return createBrowserDriver({
    launch: () => ({ headless: true }),
    findBrowser: () => program,
    userDataFolder: join(places.folder, "state", "browser", "default"),
    route: () => ({ kind: "direct" }),
    guard,
    logger: createMemoryLogger({ subsystem: "browser" }),
  });
}

const signal = new AbortController().signal;

// What a call answered, which must not be a refusal.
async function outcomeOf(driver: BrowserDriver, request: BrowserRequest): Promise<BrowserOutcome> {
  const ran = await driver.run(request, { signal });
  assert.ok(ran.ok);
  return ran.value;
}

describe.skipIf(program === undefined)("the agent's browser on this machine", () => {
  beforeAll(async () => {
    // oxlint-disable-next-line vitest/no-restricted-vi-methods -- Playwright times its pipe to the browser on real timers; afterAll puts the fake ones back
    vi.useRealTimers();
    places.folder = mkdtempSync(join(tmpdir(), "browser-driver-"));
    const page = await serve(html);
    const engine = await serve("engine");
    servers.push(page.server, engine.server);
    places.origin = page.origin;
    places.engineOrigin = engine.origin;
  });

  afterAll(async () => {
    vi.useFakeTimers();
    await Promise.all(
      servers.map(async (server) => new Promise((resolve) => server.close(resolve))),
    );
    rmSync(places.folder, { recursive: true, force: true });
  });

  it.each(
    browserDriverContract({
      create: async () =>
        Promise.resolve({
          driver: driverOf(),
          page: {
            url: `${places.origin}/`,
            title: "Harbour",
            word: "harbour",
            clickedTitle: "Pressed",
          },
          refusedUrl: "http://10.0.0.1/",
        }),
    }),
  )(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
    60_000,
  );

  it("types into a field by its ref, reads it back and keeps the page from binference's port", async () => {
    const driver = driverOf();
    try {
      const went = await outcomeOf(driver, { action: "navigate", url: `${places.origin}/` });
      const ref = /textbox "Name" \[ref=(e\d+)\]/u.exec(String(went.view.snapshot))?.[1];
      await outcomeOf(driver, {
        action: "act",
        act: { kind: "type", ref: String(ref), text: "Ada" },
      });
      const read = "() => document.querySelector('#name').value";
      const typed = await outcomeOf(driver, { action: "act", act: { kind: "evaluate", fn: read } });
      expect(typed.view.value).toBe('"Ada"');
      const engine = `async () => fetch("${places.engineOrigin}/").then(() => "reached", () => "refused")`;
      const fetched = await outcomeOf(driver, {
        action: "act",
        act: { kind: "evaluate", fn: engine },
      });
      expect(fetched.view.value).toBe('"refused"');
      const printed = await outcomeOf(driver, { action: "pdf" });
      expect(printed.capture?.contentType).toBe("application/pdf");
    } finally {
      await driver.stop();
    }
  }, 60_000);
});
