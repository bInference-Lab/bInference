// oxlint-disable-next-line eslint/no-restricted-imports -- the test writes a file outside the probe's folders
import { appendFile, mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
} from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDebugDecoy } from "../probe/debug-decoy.js";
import { writeFixturePlugin } from "../testing/fixture-plugins.js";
import { testMemoryWatch } from "../testing/memory-watch.js";
import { buildPluginBundles, type PluginBundles } from "../testing/plugin-bundles.js";
import { createPluginHost } from "./create-plugin-host.js";
import { createDirectStarter } from "./direct-starter.js";
import type { HostNotice } from "./host-notice.js";
import { openPlugin } from "./open-plugin.js";
import type { TurnedOff } from "./supervise-plugin.js";

let bundles: PluginBundles;
const signal = AbortSignal.timeout(120_000);
const index = { status: 200, headers: {}, body: '{"value":40}' };

beforeAll(async () => {
  bundles = await buildPluginBundles("host-");
  await mkdir(join(bundles.folder, "outside"), { recursive: true });
  await writeFile(join(bundles.folder, "outside", "secret.txt"), "not for plugins");
}, 120_000);

afterAll(async () => {
  await bundles.remove();
}, 60_000);

// Nearly a whole message: eight of them pass the 4 MiB a plugin may leave unread.
const big = { status: 200, headers: {}, body: "x".repeat(900_000) };

function parts(clock = createManualClock(), memoryLimit?: number) {
  const memory = testMemoryWatch(clock, memoryLimit);
  return {
    starter: createDirectStarter({ program: bundles.program, parentEnv: process.env, memory }),
    http: createScriptedHttp([
      { method: "GET", url: "https://api.example.com/index", response: index },
      { method: "GET", url: "https://api.example.com/big", response: big },
    ]),
    clock,
    logger: createMemoryLogger({ subsystem: "plugins" }),
  };
}

const echo = (plugin: string) => ({ plugin, tool: "echo", input: { text: "hi" } });
const byText = (a: unknown, b: unknown): number =>
  JSON.stringify(a).localeCompare(JSON.stringify(b));

const allTools = [
  "echo",
  "fetch_declared",
  "fetch_other",
  "bad_output",
  "garble",
  "crash",
  "hang",
  "where",
  "outlive",
  "hog",
  "stall",
];

interface OpenOptions {
  readonly declares?: readonly string[];
  readonly neverReady?: boolean;
  readonly clock?: ReturnType<typeof createManualClock>;
  readonly memoryLimit?: number;
}

async function opened(id: string, options: OpenOptions = {}) {
  const { clock = createManualClock(), memoryLimit, ...plugin } = options;
  const fixture = await writeFixturePlugin(bundles.folder, { id, tools: allTools, ...plugin });
  const refused: string[] = [];
  const result = await openPlugin(
    { ...fixture, config: null },
    { ...parts(clock, memoryLimit), onRefused: (host) => refused.push(host) },
    signal,
  );
  return { result, refused, fixture, clock };
}

// A plugin that started and is ready, the hosts it was refused, its folders and its clock.
async function running(id: string, options: OpenOptions = {}) {
  const { result, ...rest } = await opened(id, options);
  if (!result.ok) {
    throw new Error(`the plugin did not start: ${result.error}`);
  }
  return { plugin: result.value, ...rest };
}

describe("a community plugin the host runs", { timeout: 120_000 }, () => {
  it("answers a call whose input and output meet the tool's schemas", async () => {
    const { plugin } = await running("calls");

    await expect(plugin.call("echo", { text: "hi" }, signal)).resolves.toStrictEqual({
      ok: true,
      value: { text: "hi" },
    });
    await expect(plugin.call("echo", { text: 1 }, signal)).resolves.toStrictEqual({
      ok: false,
      error: "bad_input",
    });
    await expect(plugin.call("bad_output", {}, signal)).resolves.toStrictEqual({
      ok: false,
      error: "bad_output",
    });
    await expect(plugin.call("unlisted", {}, signal)).resolves.toStrictEqual({
      ok: false,
      error: "unknown_tool",
    });
    plugin.stop();
    await expect(plugin.ended).resolves.toBe("stopped");
  });

  it("fetches its declared host for it and refuses any other", async () => {
    const { plugin, refused } = await running("fetches");

    await expect(plugin.call("fetch_declared", {}, signal)).resolves.toStrictEqual({
      ok: true,
      value: { status: 200, body: '{"value":40}' },
    });
    await expect(plugin.call("fetch_other", {}, signal)).resolves.toStrictEqual({
      ok: true,
      value: { refused: "plugin.host_refused" },
    });
    expect(refused).toStrictEqual(["other.example.net"]);
    plugin.stop();
  });

  it("ends a plugin whose tools differ from its manifest's", async () => {
    const { result } = await opened("mismatch", { declares: ["echo"] });

    expect(result).toStrictEqual({ ok: false, error: "tools_mismatch" });
  });

  it("ends a plugin that writes a line that is not a message", async () => {
    const { plugin } = await running("garbled");

    await expect(plugin.call("garble", {}, signal)).resolves.toStrictEqual({
      ok: false,
      error: "not_running",
    });
    await expect(plugin.ended).resolves.toBe("channel_broken");
  });

  it("sees a plugin that exits as exited", async () => {
    const { plugin } = await running("crashing");

    await expect(plugin.call("crash", {}, signal)).resolves.toStrictEqual({
      ok: false,
      error: "not_running",
    });
    await expect(plugin.ended).resolves.toBe("exited");
  });
});

describe("a community plugin the host holds to its bounds", { timeout: 120_000 }, () => {
  it("ends a call after 30 seconds and forgets it, so hung calls never fill the 16 open", async () => {
    const { plugin, clock } = await running("hung");
    const hung = Array.from({ length: 16 }, async () => plugin.call("hang", {}, signal));
    await clock.advance(0);
    const seventeenth = await plugin.call("hang", {}, signal);
    await clock.advance(30_000);

    expect(seventeenth).toStrictEqual({ ok: false, error: "busy" });
    await expect(Promise.all(hung)).resolves.toStrictEqual(
      Array.from({ length: 16 }, () => ({ ok: false, error: "timeout" })),
    );
    await expect(plugin.call("echo", { text: "again" }, signal)).resolves.toStrictEqual({
      ok: true,
      value: { text: "again" },
    });
    plugin.stop();
  });

  it("ends a plugin that is not ready in 10 seconds", async () => {
    const clock = createManualClock();
    const fixture = await writeFixturePlugin(bundles.folder, {
      id: "silent",
      tools: ["echo"],
      neverReady: true,
    });
    const opening = { ...parts(clock), onRefused: () => undefined };
    const pending = openPlugin({ ...fixture, config: null }, opening, signal);
    await clock.advance(0);
    await clock.advance(10_000);

    await expect(pending).resolves.toStrictEqual({ ok: false, error: "not_ready" });
  });

  it("ends a plugin that leaves more than 4 MiB unread as stalled", async () => {
    const { plugin } = await running("stalling");
    void plugin.call("stall", {}, signal);

    await expect(plugin.ended).resolves.toBe("stalled");
  });

  it("ends a plugin whose resident memory passes its limit", async () => {
    const clock = createManualClock();
    const { plugin } = await running("hogging", { clock, memoryLimit: 200 * 1_048_576 });
    await expect(plugin.call("hog", {}, signal)).resolves.toStrictEqual({ ok: true, value: {} });
    await clock.advance(2_000);

    await expect(plugin.ended).resolves.toBe("exited");
  });

  it("runs a plugin in its package folder and hands it the data folder it may write", async () => {
    const { plugin, fixture } = await running("placed");

    await expect(plugin.call("where", {}, signal)).resolves.toStrictEqual({
      ok: true,
      value: { cwd: fixture.folders.packageFolder, dataFolder: fixture.folders.dataFolder },
    });
    plugin.stop();
  });

  it("keeps the program's own exit, which a plugin cannot replace", async () => {
    const { plugin } = await running("outliving");

    await expect(plugin.call("outlive", {}, signal)).resolves.toStrictEqual({
      ok: true,
      value: { exit: "TypeError" },
    });
    plugin.stop();
  });

  it("refuses a stored manifest a community plugin may no longer declare", async () => {
    const fixture = await writeFixturePlugin(bundles.folder, { id: "regex", tools: ["echo"] });
    const pattern = { type: "string", pattern: "^(a+)+$" };
    const tools = [{ ...fixture.manifest.tools[0], output: pattern }];
    const manifest = { ...fixture.manifest, tools } as typeof fixture.manifest;
    const opening = { ...parts(), onRefused: () => undefined };

    await expect(
      openPlugin({ ...fixture, manifest, config: null }, opening, signal),
    ).resolves.toStrictEqual({ ok: false, error: "bad_manifest" });
  });
});

describe("createPluginHost", { timeout: 120_000 }, () => {
  it("runs a plugin after the sandbox check and tells the owner of an undeclared host once", async () => {
    const fixture = await writeFixturePlugin(bundles.folder, { id: "told", tools: allTools });
    const told: HostNotice[] = [];
    const stop = new AbortController();
    const probeData = join(bundles.folder, "told-probe");
    await mkdir(probeData, { recursive: true });
    const host = createPluginHost({
      ...parts(),
      engineArgs: ["--disable-sigusr1"],
      folders: { packageFolder: bundles.probeFolder, dataFolder: probeData },
      outside: {
        file: join(bundles.folder, "outside", "secret.txt"),
        folder: join(bundles.folder, "outside"),
      },
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      tell: (notice) => told.push(notice),
      onTurnedOff: () => undefined,
    });

    const started = await host.start([{ ...fixture, config: null }], stop.signal);
    const call = { plugin: "told", tool: "fetch_other", input: {} };
    const answers = [await host.call(call, signal), await host.call(call, signal)];
    stop.abort();

    expect(started).toStrictEqual({ ok: true, value: { ownUser: false } });
    expect(answers).toStrictEqual([
      { ok: true, value: { refused: "plugin.host_refused" } },
      { ok: true, value: { refused: "plugin.host_refused" } },
    ]);
    expect(told).toStrictEqual([
      { kind: "hostRefused", plugin: "told", host: "other.example.net" },
    ]);
    await expect(host.call({ ...call, plugin: "other" }, signal)).resolves.toStrictEqual({
      ok: false,
      error: "unknown_plugin",
    });
  });

  it("turns a plugin off at once when its files or folder changed, and runs and stops others", async () => {
    const changed = await writeFixturePlugin(bundles.folder, { id: "changed", tools: ["echo"] });
    const linked = await writeFixturePlugin(bundles.folder, { id: "linked", tools: ["echo"] });
    const later = await writeFixturePlugin(bundles.folder, { id: "later", tools: ["echo"] });
    await appendFile(join(changed.folders.packageFolder, "index.mjs"), "// one more line\n");
    await symlink(
      join(bundles.folder, "outside", "secret.txt"),
      join(linked.folders.packageFolder, "secret.txt"),
    );
    const told: HostNotice[] = [];
    const off: [string, TurnedOff][] = [];
    const stop = new AbortController();
    const probeData = join(bundles.folder, "changed-probe");
    await mkdir(probeData, { recursive: true });
    const host = createPluginHost({
      ...parts(),
      engineArgs: ["--disable-sigusr1"],
      folders: { packageFolder: bundles.probeFolder, dataFolder: probeData },
      outside: {
        file: join(bundles.folder, "outside", "secret.txt"),
        folder: join(bundles.folder, "outside"),
      },
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      tell: (notice) => told.push(notice),
      onTurnedOff: (plugin, reason) => off.push([plugin, reason]),
    });

    await expect(host.run({ ...later, config: null })).resolves.toStrictEqual({
      ok: false,
      error: "sandbox_unchecked",
    });
    await host.start(
      [
        { ...changed, config: null },
        { ...linked, config: null },
      ],
      stop.signal,
    );
    await expect(host.run({ ...later, config: null })).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
    const answered = await host.call(echo("later"), signal);
    await host.stop("later");
    const afterStop = await host.call(echo("later"), signal);
    const probe = { ...later, manifest: { ...later.manifest, id: "sandbox-probe" }, config: null };
    const probeRun = await host.run(probe);
    stop.abort();

    expect(off.toSorted(byText)).toStrictEqual([
      ["changed", "files_changed"],
      ["linked", "links"],
    ]);
    expect(
      told.toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ).toStrictEqual([
      { kind: "refused", plugin: "changed", refusal: "files_changed" },
      { kind: "refused", plugin: "linked", refusal: "links" },
    ]);
    expect(answered).toStrictEqual({ ok: true, value: { text: "hi" } });
    expect(afterStop).toStrictEqual({ ok: false, error: "unknown_plugin" });
    expect(probeRun).toStrictEqual({ ok: false, error: "probe_id" });
  });

  it("starts no plugin and tells the owner when the sandbox check fails", async () => {
    const told: HostNotice[] = [];
    const host = createPluginHost({
      ...parts(),
      engineArgs: [],
      folders: { packageFolder: bundles.probeFolder, dataFolder: bundles.folder },
      outside: { file: "", folder: "" },
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      tell: (notice) => told.push(notice),
      onTurnedOff: () => undefined,
    });

    await expect(host.start([], signal)).resolves.toStrictEqual({
      ok: false,
      error: "engineDebugSignal",
    });
    expect(told).toStrictEqual([{ kind: "sandboxOff", reason: "engineDebugSignal" }]);
  });
});
