// oxlint-disable-next-line eslint/no-restricted-imports -- the test makes the launcher's run folder
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { connect, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createManualClock } from "@binference/core/testing";
import { createPlatform } from "@binference/platform";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pluginStarterContract } from "../contracts/plugin-starter-contract.js";
import type { PluginFolders } from "../process/plugin-node-arguments.js";
import { type FixturePlugin, writeFixturePlugin } from "../testing/fixture-plugins.js";
import { testMemoryWatch } from "../testing/memory-watch.js";
import { buildPluginBundles, type PluginBundles } from "../testing/plugin-bundles.js";
import { createLauncherStarter } from "./launcher-starter.js";
import { serveLauncher } from "./serve-launcher.js";

let bundles: PluginBundles;
let server: Server | undefined;
let socket = "";
// A socket's path has a short limit on macOS, so its folder is the OS's temporary one.
let home = "";
const stop = new AbortController();
const plugins = new Map<string, FixturePlugin>();
let made = 0;

beforeAll(async () => {
  bundles = await buildPluginBundles("launcher-");
  home = await mkdtemp(join(tmpdir(), "bnf-launcher-"));
  const platform = createPlatform({ binferenceHome: home });
  await mkdir(platform.stateFolder.run, { recursive: true });
  socket = platform.ipcEndpoint({ name: "launcher", installId: "test" }).address;
  server = await serveLauncher(
    {
      socket,
      program: bundles.program,
      folders: (id): PluginFolders => {
        const plugin = plugins.get(id);
        return plugin?.folders ?? { packageFolder: bundles.folder, dataFolder: bundles.folder };
      },
      // Windows loads its system libraries from SystemRoot; the image's Linux needs nothing.
      env: Object.fromEntries(
        Object.entries(process.env).flatMap(([name, value]) =>
          name.toLowerCase() === "systemroot" && value !== undefined ? [[name, value]] : [],
        ),
      ),
      memory: testMemoryWatch(createManualClock()),
    },
    stop.signal,
  );
}, 120_000);

afterAll(async () => {
  stop.abort();
  await new Promise((resolve) => {
    server?.once("close", resolve);
  });
  await bundles.remove();
  await rm(home, { recursive: true, force: true });
}, 60_000);

describe("createLauncherStarter over the plugin launcher", { timeout: 60_000 }, () => {
  it.each(
    pluginStarterContract({
      create: async () => {
        made += 1;
        const plugin = await writeFixturePlugin(bundles.folder, {
          id: `echo-${String(made)}`,
          tools: ["echo"],
        });
        plugins.set(plugin.manifest.id, plugin);
        return {
          starter: createLauncherStarter({ socket }),
          launch: { id: plugin.manifest.id, folders: plugin.folders },
          entry: join(plugin.folders.packageFolder, plugin.manifest.entry),
        };
      },
    }),
  )("follows the PluginStarter contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("closes a connection whose first line names no plugin", async () => {
    const connection = connect(socket);
    connection.write('{"plugin":"../engine","args":["--allow-net"]}\n');
    const closed = await new Promise<boolean>((resolve) => {
      connection.once("close", () => resolve(true));
    });

    expect(closed).toBe(true);
  });

  it("refuses to start when no launcher listens", async () => {
    const starter = createLauncherStarter({ socket: `${socket}-none` });
    const launch = { id: "echo-1", folders: { packageFolder: "", dataFolder: "" } };

    await expect(starter.start(launch, AbortSignal.timeout(5_000))).rejects.toMatchObject({
      code: "plugin.launcher_unreachable",
    });
    expect(starter.ownUser).toBe(true);
  });
});
