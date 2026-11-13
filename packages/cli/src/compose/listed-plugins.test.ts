import { join } from "node:path";
import { createManualClock, createMemoryLogger } from "@binference/core/testing";
import type { PluginNotice } from "@binference/engine/notices";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import {
  listedEntryFixture,
  listingFixture,
  listingIdFixture,
  memoryPluginRecords,
} from "../plugins/listing-fixtures.js";
import type { LockedPlugin, PluginLock } from "../plugins/plugin-lock.js";
import type { PluginRunner } from "../plugins/plugin-runner.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { cloudPluginOperations } from "./listed-plugin-harness.js";
import { composeListedPlugins } from "./listed-plugins.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-plugins-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const signal = new AbortController().signal;
const listing = listingFixture();
// A second plugin, listed under a listing of its own; the first plugin's listing is not served.
const otherListing = listingFixture({ listing: listingIdFixture(2), plugin: "other-feed" });
const other = listedEntryFixture({
  plugin: "plg_0190f1c2-3a4b-7c5d-8e6f-000000000002",
  id: "other-feed",
  manifest: { ...listedEntryFixture().manifest, id: "other-feed" },
  listing: { listing: otherListing.listing, version: 1 },
});

// Operations over a lock that already holds `entries`, as installs left it.
async function seeded(name: string, entries: readonly LockedPlugin[]) {
  const place = join(folder.path, name);
  await ensurePrivateFolder(place, { permissions: noPermissions, signal });
  const ops = cloudPluginOperations({ registry, http, folder: place });
  await ops.records.change(() => ({ plugins: entries }), signal);
  return ops;
}

const names = (lock: PluginLock): string =>
  lock.plugins
    .filter(({ enabled }) => enabled)
    .map(({ id }) => id)
    .join(",");

describe("the plugins under the Cloud root's listing rule", () => {
  it("reads the revocation list at the start and turns a revoked plugin off before any starts", async () => {
    const ops = await seeded("revoked-at-start", [listedEntryFixture()]);
    ops.root.pluginListing.catalog.list(listing);
    ops.root.pluginListing.catalog.revoke(listing.listing);

    await ops.start(signal);

    await expect(ops.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false, listing: { revoked: true } }],
    });
    expect(ops.told).toStrictEqual([{ kind: "revoked", plugin: "echo-feed", version: "1.0.0" }]);
    expect(ops.asked).not.toContain("begin echo-feed");
  });

  it("offers no held plugin's tools when the host turns another plugin off", async () => {
    const ops = await seeded("turned-off", [listedEntryFixture(), other]);
    ops.root.pluginListing.catalog.list(otherListing);
    await ops.start(signal);
    const before = ops.asked.length;

    ops.turnOff("other-feed", "crashes");
    await ops.records.read(signal);

    expect(ops.isHeld("echo-feed")).toBe(true);
    expect(ops.asked.slice(before)).toStrictEqual(["offer "]);
  });
});

describe("the plugins where no listing is needed", () => {
  it("runs them as the host does, reading no catalog", async () => {
    const asked: string[] = [];
    const host: PluginRunner = {
      begin: async (lock) => {
        asked.push(`begin ${names(lock)}`);
        return Promise.resolve(true);
      },
      run: async () => Promise.resolve(),
      stop: async () => Promise.resolve(),
      call: async () => Promise.resolve({ ok: false, error: "unknown_plugin" }),
      offer: async (lock) => {
        asked.push(`offer ${names(lock)}`);
        return Promise.resolve();
      },
    };
    const told: PluginNotice[] = [];
    const plugins = composeListedPlugins({
      rule: { kind: "notRequired" },
      records: memoryPluginRecords({ plugins: [listedEntryFixture()] }),
      runnerOf: () => host,
      clock: createManualClock(0),
      logger: createMemoryLogger({ subsystem: "plugins" }),
      tell: (notice) => told.push(notice),
      life: signal,
    });

    await plugins.start(signal);

    expect(plugins.runner).toBe(host);
    expect(plugins.listing).toBeUndefined();
    expect(plugins.watch).toBeUndefined();
    expect(asked).toStrictEqual(["begin echo-feed", "offer echo-feed"]);
    expect(told).toStrictEqual([]);
  });
});
