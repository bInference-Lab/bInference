// oxlint-disable-next-line eslint/no-restricted-imports -- the test writes a file outside the plugin's folder
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createIdSource, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import type { PluginNotice } from "@binference/engine/notices";
import { ensurePrivateFolder, realFilePath, removePath } from "@binference/platform";
import { createDirectStarter, startDebugDecoy } from "@binference/plugin-host";
import {
  buildPluginBundles,
  type PluginBundles,
  testMemoryWatch,
} from "@binference/plugin-host/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { protocolIdSchema } from "@binference/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { readPluginSource } from "../plugins/fetch-plugin.js";
import { createInstallHarness } from "../plugins/install-harness.js";
import { installPlugin } from "../plugins/install-plugin.js";
import { createListedRunner } from "../plugins/listed-runner.js";
import { listingFixture } from "../plugins/listing-fixtures.js";
import { listingGateOf } from "../plugins/listing-gate.js";
import { createListingWatch } from "../plugins/listing-watch.js";
import { createNpmRegistry } from "../plugins/npm-registry.js";
import { createPluginRecords } from "../plugins/plugin-records.js";
import { createPluginRunner } from "../plugins/plugin-runner.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { createClosers } from "./closers.js";
import { composeCloudTestRoot } from "./cloud-test-root.js";
import { createPluginOperations } from "./plugin-operations.js";

let bundles: PluginBundles;
let http: SystemHttp;
let registry: FakeNpmRegistry;

beforeAll(async () => {
  bundles = await buildPluginBundles("listed-revoke-");
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
}, 120_000);

afterAll(async () => {
  await registry.close();
  await http.close();
  await bundles.remove();
}, 60_000);

const startMs = 1_767_261_600_000;
const signal = new AbortController().signal;
const agent = protocolIdSchema("agent").parse("agt_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const runtimeToken = idSchema("tok").parse("tok_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const owner: EngineCaller = {
  credential: "tok_0190f1c2-3a4b-7c5d-8e6f-000000000001",
  client: { kind: "cli", version: "test" },
  scopes: ["read", "confirm", "admin"],
  transport: "ipc",
};
const runtime: EngineCaller = { ...owner, credential: runtimeToken, scopes: ["read", "agent"] };
const turn = protocolIdSchema("chatTurn").parse("trn_0190f1c2-3a4b-7c5d-8e6f-000000000003");
const tool = (name: string) => ({
  name,
  description: "Answers its input.",
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object" },
});
const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [tool("echo"), tool("wait")],
};
// `wait` never answers, so a call of it is in flight when the listing is revoked.
const index = {
  path: "index.mjs",
  text: "export const tools = { echo: async (input) => input, wait: async () => new Promise(() => {}) };\n",
};

// The listing the catalog signs for a published version, from the review an install shows.
async function listingFor(root: string, hash: string) {
  const clock = createManualClock(startMs);
  const harness = createInstallHarness({
    registryBase: registry.base,
    http,
    folder: join(root, "review"),
    clock,
  });
  const from = readPluginSource("npm:echo-feed@1.0.0", hash);
  if (!from.ok) {
    throw new Error("Expected an npm source.");
  }
  const answer = await installPlugin(
    harness.parts,
    { source: "npm:echo-feed@1.0.0", from: from.value },
    signal,
  );
  if (answer.ok || answer.failure.code !== "plugin.review_needed") {
    throw new Error("Expected a review.");
  }
  const { review } = answer.failure;
  const listing = listingFixture({
    integrity: hash,
    files: review.hash,
    tools: review.tools,
    configKeys: review.configKeys,
  });
  return { listing, digest: review.digest };
}

// The plugin operations, a real plugin host and the revocation list's watch, as the Cloud root
// would compose them.
async function cloudOnRealHost(root: string) {
  await mkdir(join(root, "probe-data"), { recursive: true });
  await mkdir(join(root, "outside"), { recursive: true });
  await writeFile(join(root, "outside", "secret.txt"), "not for plugins");
  const clock = createManualClock(startMs);
  const cloud = composeCloudTestRoot({ clock });
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const gate = listingGateOf(cloud.pluginListing, { clock, logger });
  if (gate === undefined) {
    throw new Error("Expected the Cloud root to require listings.");
  }
  const records = createPluginRecords({
    file: join(root, "lock.json"),
    permissions: noPermissions,
    form: "required",
  });
  const life = new AbortController();
  const turns = createRunningTurns();
  turns.startRuntime(runtimeToken);
  const data = (id: string) => join(root, "data", id);
  const host = createPluginRunner({
    life: life.signal,
    hostParts: async () => ({
      starter: createDirectStarter({
        program: bundles.program,
        parentEnv: process.env,
        memory: testMemoryWatch(clock),
      }),
      folders: {
        packageFolder: bundles.probeFolder,
        dataFolder: await realFilePath(join(root, "probe-data"), signal),
      },
      outside: { file: join(root, "outside", "secret.txt"), folder: join(root, "outside") },
      http: createScriptedHttp([]),
      clock,
      logger,
      engineArgs: ["--disable-sigusr1"],
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
    }),
    tell: () => undefined,
    onTurnedOff: () => undefined,
    foldersOf: async (id) => ({
      packageFolder: await realFilePath(join(root, "packages", id), signal),
      dataFolder: await realFilePath(data(id), signal),
    }),
    configOf: () => ({}),
    offer: async () => Promise.resolve(),
    logger,
  });
  const runner = createListedRunner({ runner: host, gate, logger, life: life.signal });
  const ids = createIdSource({ clock, random: createSeededRandom(5) });
  const told: PluginNotice[] = [];
  const ends: ((push: EnginePush) => void)[] = [];
  const handlers = createPluginOperations({
    registry: createNpmRegistry({ download: http, base: registry.base }),
    verify: async () => Promise.resolve({ ok: false, error: "unverified" }),
    records,
    shelf: { packages: join(root, "packages"), work: join(root, "work") },
    runner,
    isHeld: (id) => runner.isHeld(id),
    makeData: async (id, makeSignal) =>
      ensurePrivateFolder(data(id), { permissions: noPermissions, signal: makeSignal }),
    removeData: async (id, removeSignal) => removePath(data(id), removeSignal),
    newPlugin: () => ids.next("plg"),
    turns,
    publish: (push) => ends.shift()?.(push),
    closers: createClosers(),
    clock,
    random: createSeededRandom(6),
    logger,
    listing: gate,
  });
  const watch = createListingWatch({
    gate,
    records,
    runner,
    clock,
    logger,
    tell: (notice) => told.push(notice),
    life: life.signal,
  });
  const nextPush = async () => new Promise<EnginePush>((resolve) => ends.push(resolve));
  return { cloud, handlers, records, watch, turns, told, life, nextPush };
}

describe(
  "a revoked listing on the Cloud composition, on a real plugin host",
  { timeout: 120_000 },
  () => {
    it("stops the running plugin, ends its call in flight and keeps it off for good", async () => {
      const root = join(bundles.folder, "revoke");
      const hash = registry.publish({
        name: "echo-feed",
        version: "1.0.0",
        files: [index],
        manifest,
      });
      const { listing, digest } = await listingFor(root, hash);
      const ops = await cloudOnRealHost(root);
      ops.cloud.pluginListing.catalog.list(listing);
      const ended = ops.nextPush();
      await ops.handlers["plugin/add"]?.({
        args: { source: "npm:echo-feed@1.0.0", hash, accepted: digest, typedName: "echo-feed" },
        caller: owner,
        signal,
      });
      const done = await ended;
      const [entry] = (await ops.records.read(signal)).plugins;
      const plugin = protocolIdSchema("installedPlugin").parse(entry?.plugin);
      const call = (name: string) => ({
        args: { agent, plugin, tool: name, input: {} },
        caller: runtime,
        signal,
      });
      ops.turns.start({ agent, turn, hasOutsideContent: false });
      const answered = await ops.handlers["plugin/call"]?.(call("echo"));
      // The call's end is caught as it comes, so its rejection is never left unheard.
      const inFlight = ops.handlers["plugin/call"]?.(call("wait")).catch((error: unknown) => error);

      ops.cloud.pluginListing.catalog.revoke(listing.listing);
      await ops.watch.check(signal);

      const ending = await inFlight;
      const after = await ops.handlers["plugin/call"]?.(call("echo"));
      const list = await ops.handlers["plugin/list"]?.({ args: {}, caller: owner, signal });
      const enabled = await ops.handlers["plugin/enable"]?.({
        args: { plugin },
        caller: owner,
        signal,
      });
      ops.life.abort();

      expect(done.kind).toBe("job/done");
      expect(answered).toStrictEqual({ ok: true, value: { output: {} } });
      expect(ending).toMatchObject({
        code: "plugin.call_failed",
        details: { reason: "not_running" },
      });
      expect(ops.turns.runningOf(agent)?.hasOutsideContent).toBe(true);
      expect(after).toStrictEqual({ ok: false, error: "plugin.disabled" });
      expect(list).toMatchObject({
        ok: true,
        value: { items: [{ state: "disabled", listing: { state: "revoked" } }] },
      });
      expect(JSON.stringify(list)).not.toContain("disabledReason");
      expect(enabled).toStrictEqual({ ok: false, error: "plugin.listing_revoked" });
      expect(ops.told).toStrictEqual([{ kind: "revoked", plugin: "echo-feed", version: "1.0.0" }]);
    });
  },
);
