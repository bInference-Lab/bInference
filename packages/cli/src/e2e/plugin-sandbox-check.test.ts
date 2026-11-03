import { buildPluginBundles, type PluginBundles } from "@binference/plugin-host/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "../program/run-cli.js";
import {
  createTestMachines,
  freePort,
  hostOn,
  hostWith,
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
