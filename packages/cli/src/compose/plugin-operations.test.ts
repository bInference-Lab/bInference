// oxlint-disable-next-line eslint/no-restricted-imports -- the test changes an installed plugin's file
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { BinferenceError, createIdSource, idSchema } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
  createSeededRandom,
} from "@binference/core/testing";
import type { EngineCaller, EnginePush } from "@binference/engine";
import { createRunningTurns } from "@binference/engine/chat";
import { ensurePrivateFolder, realFilePath, removePath } from "@binference/platform";
import { createDirectStarter, startDebugDecoy } from "@binference/plugin-host";
import {
  buildPluginBundles,
  type PluginBundles,
  testMemoryWatch,
} from "@binference/plugin-host/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { jobFailedPushSchema, pluginReviewSchema, protocolIdSchema } from "@binference/protocol";
import type { RuntimePlugin } from "@binference/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { noPermissions } from "../e2e/test-host.js";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { createNpmRegistry } from "../plugins/npm-registry.js";
import { createPluginRecords } from "../plugins/plugin-records.js";
import { createPluginRunner } from "../plugins/plugin-runner.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import { createClosers } from "./closers.js";
import { createPluginOperations } from "./plugin-operations.js";

let bundles: PluginBundles;
let http: SystemHttp;
let registry: FakeNpmRegistry;

beforeAll(async () => {
  bundles = await buildPluginBundles("ops-");
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
}, 120_000);

afterAll(async () => {
  await registry.close();
  await http.close();
  await bundles.remove();
}, 60_000);

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
const signal = AbortSignal.timeout(110_000);

const echo = {
  name: "echo",
  description: "Answers its text.",
  input: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  output: { type: "object" },
};
const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [echo],
};
const index = {
  path: "index.mjs",
  text: "export const tools = { echo: async (input) => input };\n",
};

/** When the test's data folders fail: each make after the first `makes`, and every removal. */
interface DataFailures {
  readonly makes?: number;
  readonly removes?: boolean;
}

const diskFull = (): never => {
  throw new BinferenceError({ code: "platform.write_failed", message: "The disk is full." });
};

// The operations over a real plugin host and the fake registry, in a folder of the bundles, which
// has no link on its way.
async function operations(name: string, failures: DataFailures = {}) {
  const root = join(bundles.folder, name);
  const probeData = join(root, "probe-data");
  const outside = join(root, "outside");
  await mkdir(probeData, { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "secret.txt"), "not for plugins");
  const clock = createManualClock(1_767_261_610_000);
  const random = createSeededRandom(5);
  const logger = createMemoryLogger({ subsystem: "plugins" });
  const turns = createRunningTurns();
  turns.startRuntime(runtimeToken);
  const offered: (readonly RuntimePlugin[])[] = [];
  const pushes: EnginePush[] = [];
  const waiting: { next?: (push: EnginePush) => void } = {};
  const files = { permissions: noPermissions };
  const records = createPluginRecords({
    file: join(root, "lock.json"),
    permissions: noPermissions,
  });
  const data = (id: string) => join(root, "data", id);
  const memory = testMemoryWatch(clock);
  const closers = createClosers();
  const life = new AbortController();
  const turnedOff: Promise<unknown>[] = [];
  const runner = createPluginRunner({
    life: life.signal,
    hostParts: async () => ({
      starter: createDirectStarter({ program: bundles.program, parentEnv: process.env, memory }),
      folders: {
        packageFolder: bundles.probeFolder,
        dataFolder: await realFilePath(probeData, signal),
      },
      outside: { file: join(outside, "secret.txt"), folder: outside },
      http: createScriptedHttp([]),
      clock,
      logger,
      engineArgs: ["--disable-sigusr1"],
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
    }),
    tell: () => undefined,
    onTurnedOff: (id, reason) => {
      const written = records.change(
        (lock) => ({
          plugins: lock.plugins.map((entry) =>
            entry.id === id ? { ...entry, enabled: false, disabledReason: reason } : entry,
          ),
        }),
        signal,
      );
      turnedOff.push(written);
    },
    foldersOf: async (id) => ({
      packageFolder: await realFilePath(join(root, "packages", id), signal),
      dataFolder: await realFilePath(data(id), signal),
    }),
    configOf: () => ({}),
    offer: async (plugins) => {
      offered.push(plugins);
      return Promise.resolve();
    },
    logger,
  });
  const ids = createIdSource({ clock, random });
  const made = { count: 0 };
  const handlers = createPluginOperations({
    registry: createNpmRegistry({ download: http, base: registry.base }),
    verify: async () => ({ ok: false, error: "unverified" }),
    records,
    shelf: { packages: join(root, "packages"), work: join(root, "work") },
    runner,
    makeData: async (id, makeSignal) => {
      made.count += 1;
      return made.count > (failures.makes ?? Infinity)
        ? diskFull()
        : ensurePrivateFolder(data(id), { ...files, signal: makeSignal });
    },
    removeData: async (id, removeSignal) =>
      failures.removes === true ? diskFull() : removePath(data(id), removeSignal),
    newPlugin: () => ids.next("plg"),
    turns,
    publish: (push) => {
      pushes.push(push);
      waiting.next?.(push);
    },
    closers,
    clock,
    random,
    logger,
  });
  const nextPush = async () =>
    new Promise<EnginePush>((resolve) => {
      waiting.next = resolve;
    });
  return { root, handlers, nextPush, offered, turns, turnedOff, life, closers };
}

type Ops = Awaited<ReturnType<typeof operations>>;
type PluginOperation =
  | "plugin/list"
  | "plugin/add"
  | "plugin/enable"
  | "plugin/disable"
  | "plugin/remove"
  | "plugin/call";

function handler<N extends PluginOperation>(ops: Ops, name: N) {
  const found = ops.handlers[name];
  if (found === undefined) {
    throw new Error(`Expected ${name}.`);
  }
  return found;
}

// Starts `plugin/add` and answers how its job ended.
async function added(
  ops: Ops,
  args: {
    readonly source: string;
    readonly hash: string;
    readonly accepted?: string;
    readonly typedName?: string;
  },
) {
  const ended = ops.nextPush();
  const started = await handler(ops, "plugin/add")({ args, caller: owner, signal });
  expect(started.ok).toBe(true);
  return ended;
}

// The job an add answered; an add refused fails the test.
function jobOf(answer: Awaited<ReturnType<ReturnType<typeof handler<"plugin/add">>>>): string {
  if (!answer.ok) {
    throw new Error(`Expected a job, got ${answer.error}.`);
  }
  return answer.value.job;
}

// The review a failed job carries in its details, as the CLI reads it.
function reviewOf(push: EnginePush) {
  const failed = jobFailedPushSchema.parse(push.data);
  return pluginReviewSchema.parse(JSON.parse(String(failed.error.details?.["review"])));
}

async function listed(ops: Ops) {
  const list = await handler(ops, "plugin/list")({ args: {}, caller: owner, signal });
  return list.ok ? list.value.items : [];
}

// The one installed plugin's `plg_` id; a test with none fails.
async function onlyPlugin(ops: Ops) {
  const [first] = await listed(ops);
  if (first === undefined) {
    throw new Error("Expected an installed plugin.");
  }
  return first.plugin;
}

const call = (plugin: string) => ({
  args: {
    agent,
    plugin: protocolIdSchema("installedPlugin").parse(plugin),
    tool: "echo",
    input: { text: "hi" },
  },
  caller: runtime,
  signal,
});

describe("the plugin operations on a real plugin host", { timeout: 120_000 }, () => {
  it("install only after the review, run the plugin for the agent and take it away at once", async () => {
    const ops = await operations("installs");
    const hash = registry.publish({
      name: "echo-feed",
      version: "1.0.0",
      files: [index],
      manifest,
    });
    const source = "npm:echo-feed@1.0.0";

    const review = reviewOf(await added(ops, { source, hash }));
    const untyped = await added(ops, { source, hash, accepted: review.digest });
    const done = await added(ops, {
      source,
      hash,
      accepted: review.digest,
      typedName: "echo-feed",
    });
    const [installed] = await listed(ops);
    const plugin = await onlyPlugin(ops);
    ops.turns.start({ agent, turn, hasOutsideContent: false });
    const answered = await handler(ops, "plugin/call")(call(plugin));
    const marked = ops.turns.runningOf(agent)?.hasOutsideContent;
    await handler(
      ops,
      "plugin/disable",
    )({
      args: { plugin },
      caller: owner,
      signal,
    });
    const afterDisable = ops.offered.at(-1);
    const refused = await handler(ops, "plugin/call")(call(plugin));
    ops.life.abort();

    expect(review).toMatchObject({
      plugin: "echo-feed",
      version: "1.0.0",
      provenance: "none",
      publisher: "fake-publisher",
      kinds: ["data"],
      hosts: ["api.example.com"],
      tools: ["echo"],
    });
    expect(reviewOf(untyped).digest).toBe(review.digest);
    expect(done.kind).toBe("job/done");
    expect(installed).toMatchObject({
      name: "echo-feed",
      state: "enabled",
      hash: review.hash,
      tools: ["echo_feed__echo"],
    });
    expect(answered).toStrictEqual({ ok: true, value: { output: { text: "hi" } } });
    expect(marked).toBe(true);
    expect(afterDisable).toStrictEqual([]);
    expect(refused).toStrictEqual({ ok: false, error: "plugin.disabled" });
  });

  it("refuses another integrity, and holds an update that widens while the old version runs", async () => {
    const ops = await operations("updates");
    const hash = registry.publish({
      name: "echo-feed",
      version: "2.0.0",
      files: [index],
      manifest,
    });
    const first = reviewOf(await added(ops, { source: "npm:echo-feed@2.0.0", hash }));
    await added(ops, {
      source: "npm:echo-feed@2.0.0",
      hash,
      accepted: first.digest,
      typedName: "echo-feed",
    });
    const wider = { ...manifest, hosts: ["api.example.com", "x.example.net"] };
    const newer = registry.publish({
      name: "echo-feed",
      version: "2.1.0",
      files: [index],
      manifest: wider,
    });
    const other = `sha512-${Buffer.alloc(64, 1).toString("base64")}`;

    const mismatch = jobFailedPushSchema.parse(
      (await added(ops, { source: "npm:echo-feed@2.1.0", hash: other })).data,
    );
    const widening = reviewOf(await added(ops, { source: "npm:echo-feed@2.1.0", hash: newer }));
    const [kept] = await listed(ops);
    const answered = await handler(ops, "plugin/call")(call(await onlyPlugin(ops)));
    ops.life.abort();

    expect(mismatch.error.code).toBe("plugin.hash_mismatch");
    expect(widening.widens).toStrictEqual({
      from: "2.0.0",
      added: { kinds: [], hosts: ["x.example.net"], tools: [], configKeys: [] },
    });
    expect(kept).toMatchObject({ version: "2.0.0", state: "enabled" });
    expect(answered).toStrictEqual({ ok: true, value: { output: { text: "hi" } } });
  });

  it("turns a plugin off as changed when its installed files no longer hash to its pin", async () => {
    const ops = await operations("changed");
    const hash = registry.publish({
      name: "echo-feed",
      version: "3.0.0",
      files: [index],
      manifest,
    });
    const first = reviewOf(await added(ops, { source: "npm:echo-feed@3.0.0", hash }));
    await added(ops, {
      source: "npm:echo-feed@3.0.0",
      hash,
      accepted: first.digest,
      typedName: "echo-feed",
    });
    const plugin = await onlyPlugin(ops);
    await handler(ops, "plugin/disable")({ args: { plugin }, caller: owner, signal });
    await appendFile(join(ops.root, "packages", "echo-feed", "index.mjs"), "// changed\n");
    const enabled = await handler(
      ops,
      "plugin/enable",
    )({ args: { plugin }, caller: owner, signal });
    await Promise.all(ops.turnedOff);
    const [off] = await listed(ops);
    await handler(ops, "plugin/remove")({ args: { plugin }, caller: owner, signal });
    const left = await readdir(join(ops.root, "packages"));
    ops.life.abort();

    expect(enabled).toMatchObject({
      ok: true,
      value: { state: "disabled", disabledReason: "changed" },
    });
    expect(off).toMatchObject({ state: "disabled", disabledReason: "changed" });
    expect(await listed(ops)).toStrictEqual([]);
    expect(left).toStrictEqual([]);
  });

  it("keeps the old package running when an update cannot be written", async () => {
    const ops = await operations("failed-update", { makes: 1 });
    const hash = registry.publish({
      name: "echo-feed",
      version: "4.0.0",
      files: [index],
      manifest,
    });
    const first = reviewOf(await added(ops, { source: "npm:echo-feed@4.0.0", hash }));
    const typed = { accepted: first.digest, typedName: "echo-feed" };
    await added(ops, { source: "npm:echo-feed@4.0.0", hash, ...typed });
    const changed = { ...index, text: `${index.text}// 4.1.0\n` };
    const newer = registry.publish({
      name: "echo-feed",
      version: "4.1.0",
      files: [changed],
      manifest,
    });

    const failed = jobFailedPushSchema.parse(
      (await added(ops, { source: "npm:echo-feed@4.1.0", hash: newer, typedName: "echo-feed" }))
        .data,
    );
    const [kept] = await listed(ops);
    const answered = await handler(ops, "plugin/call")(call(await onlyPlugin(ops)));
    const file = await readFile(join(ops.root, "packages", "echo-feed", "index.mjs"), "utf8");
    ops.life.abort();

    expect(failed.error.code).toBe("plugin.install_failed");
    expect(kept).toMatchObject({ version: "4.0.0", state: "enabled" });
    expect(answered).toStrictEqual({ ok: true, value: { output: { text: "hi" } } });
    expect(file).toBe(index.text);
  });

  it("keeps a plugin whose data folder stays installed and running, so a remove can be asked again", async () => {
    const ops = await operations("failed-remove", { removes: true });
    const hash = registry.publish({
      name: "echo-feed",
      version: "5.0.0",
      files: [index],
      manifest,
    });
    const first = reviewOf(await added(ops, { source: "npm:echo-feed@5.0.0", hash }));
    await added(ops, {
      source: "npm:echo-feed@5.0.0",
      hash,
      accepted: first.digest,
      typedName: "echo-feed",
    });
    const plugin = await onlyPlugin(ops);

    const removed = handler(ops, "plugin/remove")({ args: { plugin }, caller: owner, signal });
    await expect(removed).rejects.toMatchObject({ code: "plugin.data_not_removed" });
    const [kept] = await listed(ops);
    const answered = await handler(ops, "plugin/call")(call(plugin));
    ops.life.abort();

    expect(kept).toMatchObject({ version: "5.0.0", state: "enabled" });
    expect(answered).toStrictEqual({ ok: true, value: { output: { text: "hi" } } });
  });

  it("refuses a second add asking for another plugin as busy, naming the install under way", async () => {
    const ops = await operations("busy");
    const hash = registry.publish({
      name: "echo-feed",
      version: "6.0.0",
      files: [index],
      manifest,
    });
    const args = { source: "npm:echo-feed@6.0.0", hash };
    const ended = ops.nextPush();
    const first = await handler(ops, "plugin/add")({ args, caller: owner, signal });
    const same = await handler(ops, "plugin/add")({ args, caller: owner, signal });
    const other = handler(
      ops,
      "plugin/add",
    )({ args: { ...args, accepted: "a".repeat(64) }, caller: owner, signal });
    const job = jobOf(first);

    await expect(other).rejects.toMatchObject({ code: "protocol.busy", details: { job } });
    await ended;
    ops.life.abort();

    expect(same).toStrictEqual(first);
  });
});
