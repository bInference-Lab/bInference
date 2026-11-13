import { join } from "node:path";
import { createMemoryQuotaSource } from "@binference/engine/testing";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { protocolIdSchema } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { listedEntryFixture, listingFixture } from "../plugins/listing-fixtures.js";
import type { LockedPlugin } from "../plugins/plugin-lock.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { type CloudPluginOperations, cloudPluginOperations } from "./listed-plugin-harness.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-enable-");
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
async function seeded(name: string, entry: LockedPlugin, extra = {}) {
  const place = join(folder.path, name);
  await ensurePrivateFolder(place, { permissions: noPermissions, signal });
  const ops = cloudPluginOperations({ registry, http, folder: place }, extra);
  await ops.records.change(() => ({ plugins: [entry] }), signal);
  return ops;
}

const enable = async (ops: CloudPluginOperations) =>
  ops.handlers["plugin/enable"]?.({ args: { plugin }, caller: ops.owner, signal });

describe("turning a plugin on under the listing rule", () => {
  it("turns on a plugin whose listing passes, at the newer version its check read", async () => {
    const ops = await seeded("passes", off);
    ops.root.pluginListing.catalog.list({ ...listing, version: 3 });

    const answer = await enable(ops);
    const lock = await ops.records.read(signal);

    expect(answer).toMatchObject({
      ok: true,
      value: {
        state: "enabled",
        listing: { listing: listing.listing, version: 3, state: "listed" },
      },
    });
    expect(lock.plugins).toMatchObject([{ enabled: true, listing: { version: 3 } }]);
  });

  it("refuses a revoked listing before it reads the quota, changing nothing", async () => {
    const reads: string[] = [];
    const quotas = createMemoryQuotaSource({});
    const counted = {
      read: async (call: { readonly signal: AbortSignal }) => {
        reads.push("quota");
        return quotas.read(call);
      },
    };
    const ops = await seeded("revoked", off, { quotas: counted });
    ops.root.pluginListing.catalog.list(listing);
    ops.root.pluginListing.catalog.revoke(listing.listing);

    await expect(enable(ops)).resolves.toStrictEqual({
      ok: false,
      error: "plugin.listing_revoked",
    });
    await expect(ops.records.read(signal)).resolves.toStrictEqual({ plugins: [off] });
    expect(reads).toStrictEqual([]);
  });

  it("refuses an entry with no listing, and a listing the catalog no longer serves", async () => {
    const { listing: _none, ...unlisted } = off;
    const bare = await seeded("unlisted", unlisted);
    const gone = await seeded("gone", off);

    await expect(enable(bare)).resolves.toStrictEqual({ ok: false, error: "plugin.not_listed" });
    await expect(enable(gone)).resolves.toStrictEqual({ ok: false, error: "plugin.not_listed" });
  });

  it("refuses a listing that differs from the entry, naming the field", async () => {
    const ops = await seeded("differs", off);
    ops.root.pluginListing.catalog.list({ ...listing, tools: ["echo", "shout"] });

    await expect(enable(ops)).rejects.toMatchObject({
      code: "plugin.listing_mismatch",
      details: { field: "tools" },
    });
  });

  it("refuses a listing version below the entry's, and a catalog it cannot read, as retryable", async () => {
    const older = await seeded("older", {
      ...off,
      listing: { listing: listing.listing, version: 4 },
    });
    older.root.pluginListing.catalog.list({ ...listing, version: 2 });
    const down = await seeded("down", off);
    down.root.pluginListing.catalog.goDown("refuse");

    await expect(enable(older)).rejects.toMatchObject({
      code: "plugin.listings_unreachable",
      retryable: true,
      details: { reason: "bad_answer" },
    });
    await expect(enable(down)).rejects.toMatchObject({ details: { reason: "unreachable" } });
  });

  it("shows a held plugin as held, and one with no listing as unlisted", async () => {
    const ops = await seeded("held", listedEntryFixture());
    ops.root.pluginListing.catalog.goDown("refuse");
    await ops.runner.begin(await ops.records.read(signal));
    const list = await ops.handlers["plugin/list"]?.({ args: {}, caller: ops.owner, signal });
    const { listing: _none, ...unlisted } = off;
    const bare = await seeded("bare", unlisted);
    const bareList = await bare.handlers["plugin/list"]?.({ args: {}, caller: bare.owner, signal });

    expect(list).toMatchObject({
      ok: true,
      value: { items: [{ state: "enabled", listing: { state: "held" } }] },
    });
    expect(bareList).toMatchObject({
      ok: true,
      value: { items: [{ listing: { state: "unlisted" } }] },
    });
  });
});
