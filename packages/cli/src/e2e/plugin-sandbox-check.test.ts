import { join } from "node:path";
import { ensurePrivateFolder } from "@binference/platform";
import { buildPluginBundles, type PluginBundles } from "@binference/plugin-host/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { writePluginLock } from "../plugins/plugin-lock.js";
import { runCli } from "../program/run-cli.js";
import {
  createTestMachines,
  freePort,
  hostOn,
  hostWith,
  noPermissions,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

const machines = createTestMachines();
let bundles: PluginBundles;

beforeAll(async () => {
  bundles = await buildPluginBundles("check-");
}, 120_000);

afterAll(async () => {
  await bundles.remove();
}, 60_000);

const engines: { readonly machine: TestMachine; readonly exit: Promise<number> }[] = [];

afterEach(async () => {
  engines.forEach(({ machine }) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(engines.splice(0).map(async ({ exit }) => exit));
  await machines.removeAll();
});

// Starts an engine in this test's process, whose Node runs without the debug-signal switch.
async function startEngine(machine: TestMachine): Promise<void> {
  const port = String(await freePort());
  const host = hostOn(machine, ["start", "--foreground", "--json", "--set", `engine.port=${port}`]);
  engines.push({ machine, exit: runCli(host) });
  await host.waitForLine((line) => line.includes('"state":"ready"'));
}

// Records one installed plugin in the machine's plugin lock, as an add leaves it.
async function installOne(machine: TestMachine): Promise<void> {
  const folder = join(machine.folder, "plugins");
  const files = { permissions: noPermissions, signal: AbortSignal.timeout(10_000) };
  await ensurePrivateFolder(folder, files);
  const manifest = {
    api: 1,
    id: "echo-feed",
    kinds: ["data"],
    entry: "index.mjs",
    hosts: [],
    tools: [],
  } as const;
  const plugin = {
    plugin: "plg_0192b3c4-d5e6-7f80-9a1b-2c3d4e5f6a7b",
    id: "echo-feed",
    packageName: "echo-feed",
    version: "1.0.0",
    source: "npm:echo-feed@1.0.0",
    integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    hash: "a".repeat(64),
    manifest,
    accepted: "b".repeat(64),
    provenance: "none",
    enabled: true,
    installedAt: 1,
  } as const;
  await writePluginLock(join(folder, "lock.json"), { plugins: [plugin] }, files);
}

async function sandboxRow(machine: TestMachine) {
  const pluginPrograms = { program: bundles.program, probeFolder: bundles.probeFolder };
  const host = hostWith(machine, ["check", "--json"], { env: {}, parts: { pluginPrograms } });
  await runCli(host);
  const { findings } = JSON.parse(host.stdout()) as {
    readonly findings: readonly { readonly check: string }[];
  };
  return findings.find(({ check }) => check === "plugins.sandbox");
}

describe("binference check, the plugin sandbox", { timeout: 120_000 }, () => {
  it("finds that the sandbox holds here, with plugins under the owner's own user", async () => {
    const machine = await machines.create(1_800_000_000_000);
    const pluginPrograms = { program: bundles.program, probeFolder: bundles.probeFolder };
    const host = hostWith(machine, ["check", "--json"], { env: {}, parts: { pluginPrograms } });
    await runCli(host);
    const { findings } = JSON.parse(host.stdout()) as {
      readonly findings: readonly { readonly check: string }[];
    };

    expect(findings.find(({ check }) => check === "plugins.sandbox")).toStrictEqual({
      check: "plugins.sandbox",
      level: "ok",
      ownUser: false,
    });
  });

  it("warns while the running engine's Node keeps its debug signal on", async () => {
    const machine = await machines.create(1_800_000_000_000);
    await writeTestConfig(machine.folder);
    await startEngine(machine);

    expect(await sandboxRow(machine)).toStrictEqual({
      check: "plugins.sandbox",
      level: "warn",
      reason: "engineDebugSignal",
    });
  });

  it("warns once a plugin is installed that plugins run under the owner's own user", async () => {
    const machine = await machines.create(1_800_000_000_000);
    await installOne(machine);

    expect(await sandboxRow(machine)).toStrictEqual({
      check: "plugins.sandbox",
      level: "warn",
      ownUser: false,
    });
  });

  it("fails while the sandbox does not hold once a plugin is installed", async () => {
    const machine = await machines.create(1_800_000_000_000);
    await writeTestConfig(machine.folder);
    await installOne(machine);
    await startEngine(machine);

    expect(await sandboxRow(machine)).toStrictEqual({
      check: "plugins.sandbox",
      level: "fail",
      reason: "engineDebugSignal",
    });
  });

  it("skips it in a run from the source files, which has no built probe", async () => {
    const machine = await machines.create(1_800_000_000_000);
    const host = hostWith(machine, ["check", "--json"], { env: {} });
    await runCli(host);
    const { findings } = JSON.parse(host.stdout()) as {
      readonly findings: readonly { readonly check: string }[];
    };

    expect(findings.find(({ check }) => check === "plugins.sandbox")).toStrictEqual({
      check: "plugins.sandbox",
      level: "skip",
    });
  });
});
