// oxlint-disable-next-line eslint/no-restricted-imports -- the suite writes its plugins' folders and a file outside them
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import {
  createManualClock,
  createMemoryLogger,
  createScriptedHttp,
} from "@binference/core/testing";
import { startNodeProgram } from "@binference/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { channelLines } from "../channel/channel-lines.js";
import { maxMessageBytes } from "../channel/channel-message.schema.js";
import { createDirectStarter } from "../host/direct-starter.js";
import { openPlugin } from "../host/open-plugin.js";
import { createLauncherStarter } from "../launcher/launcher-starter.js";
import { checkSandbox, probeManifest } from "../probe/check-sandbox.js";
import { startDebugDecoy } from "../probe/debug-decoy.js";
import { testMemoryWatch } from "../testing/memory-watch.js";
import { buildPluginBundles, type PluginBundles } from "../testing/plugin-bundles.js";
import { pluginNodeArguments } from "./plugin-node-arguments.js";

// The sandbox suite (gate check Z11, decision 0343): it builds the plugin program and the probe
// plugin as a release does, starts the probe as the host starts every community plugin, and holds
// each act the sandbox refuses to its refusal on the OS it runs on. CI runs it on Linux, macOS and
// Windows; with the plugin under the engine's own user, as here, only a signal goes through.

let bundles: PluginBundles;
let outsideFile = "";
let outsideFolder = "";
const signal = AbortSignal.timeout(120_000);

async function dataFolder(name: string): Promise<string> {
  const folder = join(bundles.folder, "data", name);
  await mkdir(folder, { recursive: true });
  return folder;
}

beforeAll(async () => {
  bundles = await buildPluginBundles("sandbox-");
  outsideFolder = join(bundles.folder, "outside");
  outsideFile = join(outsideFolder, "secret.txt");
  await mkdir(outsideFolder, { recursive: true });
  await writeFile(outsideFile, "not for plugins");
}, 120_000);

afterAll(async () => {
  await bundles.remove();
}, 60_000);

function parts() {
  const clock = createManualClock();
  return {
    starter: createDirectStarter({
      program: bundles.program,
      parentEnv: process.env,
      memory: testMemoryWatch(clock),
    }),
    http: createScriptedHttp([]),
    clock,
    logger: createMemoryLogger({ subsystem: "plugins" }),
  };
}

// Runs the probe against a decoy started with the given Node options, the engine's by default.
async function probeReport(name: string, nodeOptions?: readonly string[]) {
  const decoyOptions = { parentEnv: process.env, signal };
  const decoy = await startDebugDecoy(
    nodeOptions === undefined ? decoyOptions : { ...decoyOptions, nodeOptions },
  );
  const spec = {
    manifest: probeManifest,
    folders: { packageFolder: bundles.probeFolder, dataFolder: await dataFolder(name) },
    config: { outsideFile, outsideFolder, decoyPid: decoy.pid },
  };
  const opened = await openPlugin(spec, { ...parts(), onRefused: () => undefined }, signal);
  if (!opened.ok) {
    throw new Error(`the probe did not start: ${opened.error}`);
  }
  const answer = await opened.value.call("probe", {}, signal);
  opened.value.stop();
  const decoyDebugger = await decoy.report();
  decoy.kill();
  return { answer, decoyDebugger };
}

describe("a community plugin under the sandbox", { timeout: 120_000 }, () => {
  it("is refused every act the sandbox refuses, and opens no debugger with a signal", async () => {
    const { answer, decoyDebugger } = await probeReport("probe");

    expect(answer).toStrictEqual({
      ok: true,
      value: {
        readOutside: "refused",
        writeOutside: "refused",
        link: "refused",
        hardLink: "refused",
        fetch: "refused",
        connect: "refused",
        lookup: "refused",
        listen: "refused",
        udp: "refused",
        childProcess: "refused",
        worker: "refused",
        addon: "refused",
        wasi: "refused",
        ffi: "refused",
        ffiMemory: "refused",
        inspector: "refused",
        sqlite: "refused",
        binding: "refused",
        setFlags: "refused",
        // Node gates neither: the decoy says whether its debugger opened, and only another OS
        // user stops a signal.
        debugSignal: "allowed",
        signal: "allowed",
      },
    });
    expect(decoyDebugger).toBe("closed");
    expect(await readdir(outsideFolder)).toStrictEqual(["secret.txt"]);
  });

  it("would open a debugger in a process started without the engine's switch", async () => {
    const { answer, decoyDebugger } = await probeReport("control", []);

    expect(answer).toMatchObject({ ok: true });
    expect(decoyDebugger).toBe("open");
  });

  it("passes the sandbox check, with plugins under the engine's own user", async () => {
    const checked = await checkSandbox(
      {
        ...parts(),
        engineArgs: ["--disable-sigusr1"],
        folders: { packageFolder: bundles.probeFolder, dataFolder: await dataFolder("check") },
        outside: { file: outsideFile, folder: outsideFolder },
        startDecoy: async (decoySignal) =>
          startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      },
      signal,
    );

    expect(checked).toStrictEqual({ ok: true, value: { ownUser: false } });
  });

  it("fails the sandbox check, never throws, when the probe cannot start", async () => {
    const checked = await checkSandbox(
      {
        ...parts(),
        starter: createLauncherStarter({ socket: join(bundles.folder, "no-launcher.sock") }),
        engineArgs: ["--disable-sigusr1"],
        folders: { packageFolder: bundles.probeFolder, dataFolder: await dataFolder("none") },
        outside: { file: outsideFile, folder: outsideFolder },
        startDecoy: async (decoySignal) =>
          startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      },
      signal,
    );

    expect(checked).toStrictEqual({ ok: false, error: "probeFailed" });
  });

  it("fails the sandbox check when the engine runs without its debug-signal switch", async () => {
    const checked = await checkSandbox(
      {
        ...parts(),
        engineArgs: [],
        folders: { packageFolder: bundles.probeFolder, dataFolder: await dataFolder("off") },
        outside: { file: outsideFile, folder: outsideFolder },
        startDecoy: async (decoySignal) =>
          startDebugDecoy({ parentEnv: process.env, signal: decoySignal }),
      },
      signal,
    );

    expect(checked).toStrictEqual({ ok: false, error: "engineDebugSignal" });
  });

  it("will not run a plugin outside the permission model", async () => {
    const program = startNodeProgram({ args: [bundles.program], parentEnv: process.env, signal });

    expect(await program.exited).toBe(3);
  });

  it.each([
    ["V8's internal functions", ["--allow-natives-syntax"], {}],
    ["Node's internals", ["--expose-internals"], {}],
    ["NODE_OPTIONS", [], { NODE_OPTIONS: "--max-old-space-size=4096" }],
  ])("will not run a plugin with %s turned on", async (_name, flags, env) => {
    const folder = await dataFolder("widened");
    const args = pluginNodeArguments(bundles.program, {
      packageFolder: folder,
      dataFolder: folder,
    });
    const program = startNodeProgram({
      args: [...flags, ...args],
      parentEnv: process.env,
      env,
      signal,
    });

    expect(await program.exited).toBe(3);
  });
});

// Runs the probe's tool with no sandbox of the host's: under the permission model with every
// grant, no switch off and no lockdown, so each act the probe tries is let through, which shows
// the probe can tell each family's act from its refusal.
async function unsandboxedReport(): Promise<Readonly<Record<string, string>>> {
  const data = await dataFolder("control-all");
  const decoy = await startDebugDecoy({ parentEnv: process.env, signal });
  const probeFile = pathToFileURL(join(bundles.probeFolder, "sandbox-probe.mjs")).href;
  const config = JSON.stringify({ outsideFile, outsideFolder, decoyPid: decoy.pid });
  const program = [
    `const { tools } = await import(${JSON.stringify(probeFile)});`,
    `const context = { config: ${config}, dataFolder: ${JSON.stringify(data)},`,
    "  signal: AbortSignal.timeout(20000), fetch: async () => { throw new Error('none'); } };",
    "process.stdout.write(JSON.stringify(await tools.probe({}, context)) + '\\n');",
    "process.exit(0);",
  ].join("\n");
  const grants = [
    "--allow-fs-read=*",
    "--allow-fs-write=*",
    "--allow-net",
    "--allow-child-process",
  ];
  const more = [
    "--allow-worker",
    "--allow-addons",
    "--allow-wasi",
    "--allow-ffi",
    "--allow-inspector",
  ];
  const run = startNodeProgram({
    args: ["--permission", ...grants, ...more, "--input-type=module", "--eval", program],
    parentEnv: process.env,
    signal,
  });
  const line = await channelLines(run.output, maxMessageBytes).next();
  decoy.kill();
  run.kill();
  return z.record(z.string(), z.string()).parse(JSON.parse(line.done === true ? "{}" : line.value));
}

describe("the probe's controls", { timeout: 120_000 }, () => {
  it("sees each act let through when the sandbox grants it", async () => {
    const report = await unsandboxedReport();
    const refused = Object.entries(report).filter(([, outcome]) => outcome === "refused");

    expect(Object.keys(report)).toHaveLength(21);
    // Node refuses process.binding under the permission model whatever it grants.
    expect(refused).toStrictEqual([["binding", "refused"]]);
  });
});
