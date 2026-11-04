import { buildPluginBundles, type PluginBundles } from "@binference/plugin-host/testing";
import type { CommunityManifest } from "@binference/plugin-sdk/community";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { type FakeNpmRegistry, startFakeNpmRegistry } from "../plugins/fake-npm-registry.js";
import { runCli } from "../program/run-cli.js";
import { createSystemHttp, type SystemHttp } from "../runtime/system-http.js";
import {
  createTestMachines,
  freePort,
  type HostParts,
  hostWith,
  type TestMachine,
  writeTestConfig,
} from "./test-host.js";

const machines = createTestMachines();
let bundles: PluginBundles;
let http: SystemHttp;
let registry: FakeNpmRegistry;

beforeAll(async () => {
  bundles = await buildPluginBundles("command-");
  http = createSystemHttp({ version: "test", route: { kind: "direct" } });
  registry = await startFakeNpmRegistry();
}, 120_000);

afterAll(async () => {
  await registry.close();
  await http.close();
  await bundles.remove();
}, 60_000);

const engines: { readonly machine: TestMachine; readonly exit: Promise<number> }[] = [];

afterEach(async () => {
  engines.forEach(({ machine }) => machine.signals.emit("SIGINT", "SIGINT"));
  await Promise.allSettled(engines.splice(0).map(async ({ exit }) => exit));
  await machines.removeAll();
});

const manifest: CommunityManifest = {
  api: 1,
  id: "echo-feed",
  kinds: ["data"],
  entry: "index.mjs",
  hosts: ["api.example.com"],
  tools: [
    {
      name: "echo",
      description: "Answers its text.",
      input: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      output: { type: "object" },
    },
  ],
};
const index = {
  path: "index.mjs",
  text: "export const tools = { echo: async (input) => input };\n",
};

// What a host reaches plugins with: the built plugin program, npm's stand-in and its downloads.
function pluginParts(machine: TestMachine): HostParts {
  return {
    pluginPrograms: { program: bundles.program, probeFolder: bundles.probeFolder },
    download: http,
    outbound: http,
    npmRegistry: registry.base,
    // The engine runs in the test's process; it says it runs with its debug signal off, as the
    // built binference does, so its plugin host runs plugins.
    entry: {
      node: `${machine.folder}/bin/node`,
      script: `${machine.folder}/bin/binference.mjs`,
      nodeOptions: ["--disable-sigusr1"],
    },
  };
}

async function startEngine(machine: TestMachine): Promise<void> {
  const port = String(await freePort());
  const argv = ["start", "--foreground", "--json", "--set", `engine.port=${port}`];
  const host = hostWith(machine, argv, { env: {}, parts: pluginParts(machine) });
  engines.push({ machine, exit: runCli(host) });
  await host.waitForLine((line) => line.includes('"state":"ready"'));
}

async function run(machine: TestMachine, argv: readonly string[]) {
  const host = hostWith(machine, argv, { env: {}, parts: pluginParts(machine) });
  const code = await runCli(host);
  return { code, stdout: host.stdout(), stderr: host.stderr() };
}

describe("binference plugin", { timeout: 120_000 }, () => {
  it("adds a plugin without provenance once its name is typed, lists, disables and removes it", async () => {
    const machine = await machines.create(1_800_000_000_000);
    await writeTestConfig(machine.folder);
    await startEngine(machine);
    registry.publish({ name: "echo-feed", version: "1.0.0", files: [index], manifest });

    const unattended = await run(machine, ["plugin", "add", "npm:echo-feed@1.0.0", "--json"]);
    const added = await run(machine, [
      "plugin",
      "add",
      "npm:echo-feed@1.0.0",
      "--name",
      "echo-feed",
    ]);
    const listed = await run(machine, ["plugin", "list"]);
    const disabled = await run(machine, ["plugin", "disable", "echo-feed"]);
    const listedOff = await run(machine, ["plugin", "list"]);
    const removed = await run(machine, ["plugin", "remove", "echo-feed"]);
    const empty = await run(machine, ["plugin", "list"]);

    expect(unattended.code).toBe(1);
    expect(unattended.stdout).toContain('"error":{"code":"cli.needs_confirmation"');
    expect([added.code, added.stderr]).toStrictEqual([0, ""]);
    expect(added.stdout).toContain("Add echo-feed 1.0.0 from npm:echo-feed@1.0.0?");
    expect(added.stdout).toContain("It may reach 1 host:\n  api.example.com\n");
    expect(added.stdout).toContain("Publisher fake-publisher · npm provenance none");
    expect(added.stdout).toContain("echo-feed 1.0.0 is added and on.");
    expect(listed.stdout).toContain(
      "echo-feed 1.0.0: on · npm provenance none · tools: echo_feed__echo",
    );
    expect(disabled.stdout).toContain("echo-feed is off.");
    expect(listedOff.stdout).toContain("echo-feed 1.0.0: off, disabled by you");
    expect(removed.stdout).toContain("echo-feed is removed, with its data.");
    expect(empty.stdout).toContain("No community plugins yet.");
  });

  it("refuses a source that names no exact npm version", async () => {
    const machine = await machines.create(1_800_000_000_000);
    const refused = await run(machine, ["plugin", "add", "fear-index"]);

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain("Name the plugin as npm:package@version");
  });
});
