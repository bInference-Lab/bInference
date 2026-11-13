import { join } from "node:path";
import type { QuotaSource } from "@binference/engine/quotas";
import { createMemoryQuotaSource } from "@binference/engine/testing";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { protocolIdSchema } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import {
  asPayload,
  listedEntryFixture,
  listingFixture,
  revocationListFixture,
} from "../plugins/listing-fixtures.js";
import type { LockedPlugin } from "../plugins/plugin-lock.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { type CloudPluginOperations, cloudPluginOperations } from "./listed-plugin-harness.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-revocation-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const signal = new AbortController().signal;
const listing = listingFixture();
const off = listedEntryFixture({ enabled: false, disabledReason: "owner" });
const plugin = protocolIdSchema("installedPlugin").parse(off.plugin);

// Operations over a lock that already holds `entry`, as an install left it.
async function seeded(name: string, entry: LockedPlugin, extra: { quotas?: QuotaSource } = {}) {
  const place = join(folder.path, name);
  await ensurePrivateFolder(place, { permissions: noPermissions, signal });
  const ops = cloudPluginOperations({ registry, http, folder: place }, extra);
  await ops.records.change(() => ({ plugins: [entry] }), signal);
  return { ops, place };
}

const enable = async (ops: CloudPluginOperations) =>
  ops.handlers["plugin/enable"]?.({ args: { plugin }, caller: ops.owner, signal });

describe("a revocation that lands while the owner turns the plugin on", () => {
  it("refuses the enable whose check read the list before it, and keeps the plugin off", async () => {
    const { ops } = await seeded("enable-race", off);
    const catalog = ops.root.pluginListing.catalog;
    catalog.list(listing);
    await ops.listing.refresh(signal);
    const held = catalog.holdReads("get");
    const enabling = enable(ops);
    await held.arrived;
    catalog.revoke(listing.listing);
    await ops.watch.check(signal);
    held.release();

    await expect(enabling).resolves.toStrictEqual({
      ok: false,
      error: "plugin.listing_revoked",
    });
    const [entry] = (await ops.records.read(signal)).plugins;
    expect(entry).toMatchObject({ enabled: false, disabledReason: "owner" });
    expect(entry?.listing).toMatchObject({ revoked: true });
    expect(ops.told).toStrictEqual([{ kind: "revoked", plugin: "echo-feed", version: "1.0.0" }]);
  });
});

// A quota source whose reads wait until the test lets them go.
function heldQuotas() {
  const quotas = createMemoryQuotaSource({});
  const arrivals: (() => void)[] = [];
  const ends: (() => void)[] = [];
  const arrived = new Promise<void>((resolve) => {
    arrivals.push(resolve);
  });
  const held = new Promise<void>((resolve) => {
    ends.push(resolve);
  });
  const source: QuotaSource = {
    read: async (call) => {
      arrivals.forEach((resolve) => resolve());
      await held;
      return quotas.read(call);
    },
  };
  return { source, arrived, release: () => ends.forEach((resolve) => resolve()) };
}

describe("a revocation that lands after the enable's check, before its lock change", () => {
  it("refuses the enable in its lock change, changing nothing", async () => {
    const quotas = heldQuotas();
    const { ops } = await seeded("change-race", off, { quotas: quotas.source });
    ops.root.pluginListing.catalog.list(listing);
    const enabling = enable(ops);
    await quotas.arrived;
    ops.root.pluginListing.catalog.revoke(listing.listing);
    await ops.watch.check(signal);
    quotas.release();

    await expect(enabling).resolves.toStrictEqual({
      ok: false,
      error: "plugin.listing_revoked",
    });
    await expect(ops.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false, listing: { revoked: true } }],
    });
  });
});

describe("a revoked listing after a restart", () => {
  it("stays refused though a newer signed list no longer names it", async () => {
    const { ops, place } = await seeded("restart", off);
    const catalog = ops.root.pluginListing.catalog;
    catalog.list(listing);
    const revoked = catalog.revoke(listing.listing);
    await ops.watch.check(signal);
    const later = revocationListFixture({
      sequence: revoked.sequence + 1,
      issuedAt: ops.clock.now(),
      revoked: [],
    });
    catalog.serveRevocations(catalog.signer.sign("pluginRevocations", asPayload(later)));

    const again = cloudPluginOperations({ registry, http, folder: place }, { restartOf: ops });

    await expect(enable(again)).resolves.toStrictEqual({
      ok: false,
      error: "plugin.listing_revoked",
    });
    await expect(again.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false, listing: { revoked: true } }],
    });
  });
});
