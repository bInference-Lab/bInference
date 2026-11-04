// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads the lock file back
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writePrivateFile } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { afterEach, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { declarationsOf, digestOf } from "./plugin-declarations.js";
import {
  emptyPluginLock,
  type LockedPlugin,
  readPluginLock,
  writePluginLock,
} from "./plugin-lock.js";
import { createPluginRecords } from "./plugin-records.js";

const state: { folder?: TempFolder } = {};
const signal = AbortSignal.timeout(10_000);

afterEach(async () => {
  await state.folder?.remove();
});

const manifest: CommunityManifest = {
  api: 1,
  id: "fear-index",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["b.example.com", "a.example.com"],
  tools: [],
  config: {
    type: "object",
    properties: { days: { type: "integer" } },
    additionalProperties: false,
  },
};

const entry: LockedPlugin = {
  plugin: "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
  id: "fear-index",
  packageName: "fear-index",
  version: "1.2.0",
  source: "npm:fear-index@1.2.0",
  integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
  hash: "a".repeat(64),
  manifest,
  accepted: "b".repeat(64),
  provenance: "none",
  enabled: true,
  installedAt: 1,
};

describe("the plugin lock", () => {
  it("writes and reads its plugins back", async () => {
    state.folder = await createTempFolder("bnf-lock-");
    const file = join(state.folder.path, "lock.json");
    await writePluginLock(file, { plugins: [entry] }, { permissions: noPermissions, signal });

    await expect(readPluginLock(file, signal)).resolves.toStrictEqual({
      ok: true,
      value: { plugins: [entry] },
    });
  });

  it("holds no plugin when it is missing, and is unreadable when it does not read", async () => {
    state.folder = await createTempFolder("bnf-lock-");
    const file = join(state.folder.path, "lock.json");
    const missing = await readPluginLock(file, signal);
    await writePrivateFile(file, '{"version":1,"plugins":[{"id":"x"}]}', {
      permissions: noPermissions,
      signal,
    });

    expect(missing).toStrictEqual({ ok: true, value: emptyPluginLock });
    await expect(readPluginLock(file, signal)).resolves.toStrictEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it.each([
    ["an id that is not its manifest's", { id: "other-feed" }],
    ["an id that could name another folder", { id: "../fear-index" }],
  ])("is unreadable with %s", async (_case, change) => {
    state.folder = await createTempFolder("bnf-lock-");
    const file = join(state.folder.path, "lock.json");
    const text = JSON.stringify({ version: 1, plugins: [{ ...entry, ...change }] });
    await writePrivateFile(file, text, { permissions: noPermissions, signal });

    await expect(readPluginLock(file, signal)).resolves.toStrictEqual({
      ok: false,
      error: "unreadable",
    });
  });

  it("refuses every read and change of a lock that does not read, and writes nothing", async () => {
    state.folder = await createTempFolder("bnf-lock-");
    const file = join(state.folder.path, "lock.json");
    await writePrivateFile(file, "{ not json", { permissions: noPermissions, signal });
    const records = createPluginRecords({ file, permissions: noPermissions });
    const unreadable = { code: "plugin.lock_unreadable" };

    await expect(records.read(signal)).rejects.toMatchObject(unreadable);
    await expect(records.change(() => ({ plugins: [] }), signal)).rejects.toMatchObject(unreadable);
    await expect(readFile(file, "utf8")).resolves.toBe("{ not json");
  });
});

describe("a plugin's declarations", () => {
  it("are its kinds, hosts, tools and config keys, sorted, hashed to one digest", () => {
    const declarations = declarationsOf(manifest);

    expect(declarations).toStrictEqual({
      kinds: ["data"],
      hosts: ["a.example.com", "b.example.com"],
      tools: [],
      configKeys: ["days"],
    });
    expect(digestOf(declarations)).toBe(
      digestOf(declarationsOf({ ...manifest, hosts: ["a.example.com", "b.example.com"] })),
    );
    expect(digestOf(declarations)).toMatch(/^[0-9a-f]{64}$/);
  });
});
