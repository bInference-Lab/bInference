import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { ensurePrivateFolder } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { protocolIdSchema } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { listedEntryFixture, listingFixture } from "../plugins/listing-fixtures.js";
import { createListingWatch } from "../plugins/listing-watch.js";
import type { LockedPlugin } from "../plugins/plugin-lock.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { type CloudPluginOperations, cloudPluginOperations } from "./listed-plugin-harness.js";

let http: SystemHttp;
let registry: FakeNpmRegistry;
let folder: TempFolder;

beforeAll(async () => {
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
  folder = await createTempFolder("listed-holds-");
});

afterAll(async () => {
  await registry.close();
  await http.close();
  await folder.remove();
});

const signal = new AbortController().signal;
const listing = listingFixture();
const on = listedEntryFixture();
const plugin = protocolIdSchema("installedPlugin").parse(on.plugin);

// Operations over a lock that already holds `entry`, as an install left it.
async function seeded(
  name: string,
  entry: LockedPlugin,
  extra: Parameters<typeof cloudPluginOperations>[1] = {},
) {
  const place = join(folder.path, name);
  await ensurePrivateFolder(place, { permissions: noPermissions, signal });
  const ops = cloudPluginOperations({ registry, http, folder: place }, extra);
  await ops.records.change(() => ({ plugins: [entry] }), signal);
  return { ops, place };
}

const watchOf = (ops: CloudPluginOperations) =>
  createListingWatch({
    gate: ops.listing,
    records: ops.records,
    runner: ops.runner,
    clock: ops.clock,
    logger: ops.logger,
    tell: () => undefined,
    life: new AbortController().signal,
  });

// Starts the operations' engine with the catalog down, so the plugin on is held.
async function startedHeld(ops: CloudPluginOperations): Promise<void> {
  ops.root.pluginListing.catalog.list(listing);
  ops.root.pluginListing.catalog.goDown("refuse");
  await ops.runner.begin(await ops.records.read(signal));
  ops.root.pluginListing.catalog.comeBack();
}

// A data folder removal that fails, as a folder the launcher cannot remove does.
const failingRemoval = async (): Promise<void> =>
  Promise.reject(new BinferenceError({ code: "fs.unwritable", message: "Not removed." }));

const call = (ops: CloudPluginOperations) => ({ args: { plugin }, caller: ops.owner, signal });

describe("a held plugin under the listing rule", () => {
  it("is not run by the watch when the owner turns it off while the watch checks it", async () => {
    const { ops } = await seeded("off-during-check", on);
    await startedHeld(ops);
    const held = ops.root.pluginListing.catalog.holdReads("get");
    const checking = watchOf(ops).check(signal);
    await held.arrived;
    const disabled = await ops.handlers["plugin/disable"]?.(call(ops));
    held.release();
    await checking;

    expect(disabled).toMatchObject({ ok: true, value: { state: "disabled" } });
    expect(ops.asked).not.toContain("run echo-feed");
    await expect(ops.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false, disabledReason: "owner" }],
    });
  });

  it("is not run when the removal of its data folder fails", async () => {
    const { ops } = await seeded("remove-fails", on, { removeData: failingRemoval });
    await startedHeld(ops);

    await expect(ops.handlers["plugin/remove"]?.(call(ops))).rejects.toMatchObject({
      code: "plugin.data_not_removed",
    });
    expect(ops.asked).not.toContain("run echo-feed");
    expect(ops.runner.isHeld("echo-feed")).toBe(true);
  });
});

describe("the revocation floor after a restart, through the operations", () => {
  it("drops an older list the catalog answers, so a check cannot pass on it", async () => {
    const off = listedEntryFixture({ enabled: false, disabledReason: "owner" });
    const { ops, place } = await seeded("older-after-restart", off);
    const catalog = ops.root.pluginListing.catalog;
    catalog.list(listing);
    catalog.renew();
    await watchOf(ops).check(signal);
    const [older] = catalog.signedLists();
    catalog.serveRevocations(String(older));

    const again = cloudPluginOperations({ registry, http, folder: place }, { restartOf: ops });

    await expect(again.handlers["plugin/enable"]?.(call(again))).rejects.toMatchObject({
      code: "plugin.listings_unreachable",
      details: { reason: "bad_answer" },
    });
    await expect(again.records.read(signal)).resolves.toMatchObject({
      plugins: [{ enabled: false }],
      revocations: { sequence: 2 },
    });
  });
});
