import { realpathSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { HostLookup } from "@binference/core";
import { type RealPathStep, realPathOf } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAddressGuard } from "./address-guard.js";

const home = resolve("/srv/owner");
const state = join(home, ".binference");
const fileOf = (path: string): string => pathToFileURL(path).href;

// Names and what they resolve to; any other name does not resolve.
const names: Readonly<Record<string, string>> = {
  "example.com": "93.184.215.14",
  "rebind.example": "127.0.0.1",
  "intranet.example": "10.1.2.3",
};

const lookup: HostLookup = (hostname, _options, callback) => {
  const address = names[hostname];
  if (address === undefined) {
    callback(new Error("not found"), []);
    return;
  }
  callback(null, [{ address, family: 4 }]);
};

function guardOf(
  given: { readonly allowPrivate?: boolean; readonly links?: Record<string, string> } = {},
) {
  return createAddressGuard({
    allowPrivateNetwork: () => given.allowPrivate ?? false,
    enginePorts: () => [7456, 7457],
    publicOrigin: () => "https://owner.tailnet.example",
    walled: { roots: [state], open: [join(state, "workspace")] },
    lookup,
    realPath: async (path) => Promise.resolve(given.links?.[path] ?? path),
    allowedOrigins: ["http://127.0.0.1:43123"],
  });
}

const signal = new AbortController().signal;

describe("the check of the browser's requests", () => {
  it.each([
    ["https://example.com/page", true],
    ["wss://example.com/socket", true],
    ["http://93.184.215.14/", true],
    ["about:blank", true],
    ["data:text/html,<p>hi</p>", true],
    [fileOf(join(home, "notes", "page.html")), true],
    ["http://127.0.0.1:43123/page.html", true],
    ["http://127.0.0.1:7456/", false],
    ["ws://localhost:7456/", false],
    ["http://[::1]:7457/hook/x", false],
    ["https://owner.tailnet.example/mini", false],
    ["wss://owner.tailnet.example/", false],
    ["http://10.0.0.1/", false],
    ["http://192.168.1.1/admin", false],
    ["http://169.254.169.254/latest/meta-data", false],
    ["http://localhost:3000/", false],
    ["http://printer.local/", false],
    ["https://intranet.example/", false],
    ["https://rebind.example/", false],
    ["https://unknown.example/", false],
    [fileOf(join(state, "keys", "agent-key")), false],
    [fileOf(state), false],
    [fileOf(join(state, "workspace", "media", "page.html")), true],
    ["chrome://settings", false],
    ["javascript:alert(1)", false],
    ["not a url", false],
  ])("judges %s as %s", async (url, allowed) => {
    await expect(guardOf().allows(url, signal)).resolves.toBe(allowed);
  });

  it("lets private addresses load once the owner allows them, never the engine's ports", async () => {
    const guard = guardOf({ allowPrivate: true });
    await expect(guard.allows("http://192.168.1.1/admin", signal)).resolves.toBe(true);
    await expect(guard.allows("http://localhost:3000/", signal)).resolves.toBe(true);
    await expect(guard.allows("http://127.0.0.1:7456/", signal)).resolves.toBe(false);
    await expect(guard.allows("http://[::ffff:127.0.0.1]:7456/", signal)).resolves.toBe(false);
    await expect(guard.allows("http://[::ffff:0.0.0.0]:7457/", signal)).resolves.toBe(false);
    await expect(guard.allows("http://rebind.example:7456/", signal)).resolves.toBe(false);
    await expect(guard.allows("https://owner.tailnet.example/", signal)).resolves.toBe(false);
  });

  it("follows a file's links to its real path", async () => {
    const link = join(home, "innocent.txt");
    const guard = guardOf({ links: { [link]: join(state, "keys", "agent-key") } });
    await expect(guard.allows(fileOf(link), signal)).resolves.toBe(false);
  });
});

// Between the open and the real path: the path made a plain page the walls accept.
const swapForPlainPage: RealPathStep = async (path, stepSignal) => {
  await rm(path);
  await writeFile(path, "<p>plain</p>");
  return realPathOf(path, stepSignal);
};

describe("the files the browser gets for file: addresses", () => {
  let temp: TempFolder;
  let root: string;
  beforeEach(async () => {
    temp = await createTempFolder("guard-files-");
    root = realpathSync(temp.path);
    await mkdir(join(root, "state", "keys"), { recursive: true });
    await mkdir(join(root, "state", "workspace"), { recursive: true });
    await writeFile(join(root, "state", "keys", "agent-key"), "secret");
    await writeFile(join(root, "state", "workspace", "page.html"), "<h1>Notes</h1>");
    await writeFile(join(root, "chart.svg"), "<svg/>");
  });
  afterEach(async () => {
    await temp.remove();
  });

  const guardOver = (realPath: RealPathStep = realPathOf) =>
    createAddressGuard({
      allowPrivateNetwork: () => false,
      enginePorts: () => [],
      publicOrigin: () => undefined,
      walled: { roots: [join(root, "state")], open: [join(root, "state", "workspace")] },
      lookup,
      realPath: async (path) => realPath(path, signal),
    });

  it("serves a workspace page and a file outside the state folder with their types", async () => {
    const guard = guardOver();
    await expect(
      guard.readFile(fileOf(join(root, "state", "workspace", "page.html")), signal),
    ).resolves.toStrictEqual({
      bytes: new TextEncoder().encode("<h1>Notes</h1>"),
      contentType: "text/html; charset=utf-8",
    });
    await expect(guard.readFile(fileOf(join(root, "chart.svg")), signal)).resolves.toStrictEqual({
      bytes: new TextEncoder().encode("<svg/>"),
      contentType: "image/svg+xml",
    });
  });

  it("serves nothing of a walled file, a link to one, a folder or an address that is no file", async () => {
    const guard = guardOver();
    await symlink(join(root, "state", "keys", "agent-key"), join(root, "innocent.txt"));
    const served = await Promise.all(
      [
        fileOf(join(root, "state", "keys", "agent-key")),
        fileOf(join(root, "innocent.txt")),
        fileOf(join(root, "state", "workspace")),
        "https://example.com/page",
      ].map(async (url) => guard.readFile(url, signal)),
    );
    expect(served).toStrictEqual([undefined, undefined, undefined, undefined]);
  });

  it("serves nothing of a path that led to a walled file once it was opened", async () => {
    // At the open the page is a link to the key; by the time its real path is found it is a
    // plain page again, so only the handle's identity keeps the key from the browser.
    const page = join(root, "state", "workspace", "swapped.html");
    await symlink(join(root, "state", "keys", "agent-key"), page);
    await expect(
      guardOver(swapForPlainPage).readFile(fileOf(page), signal),
    ).resolves.toBeUndefined();
  });
});
