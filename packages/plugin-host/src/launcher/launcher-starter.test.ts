// oxlint-disable-next-line eslint/no-restricted-imports -- the test makes the launcher's run folder
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
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
import { removeLauncherData } from "./remove-launcher-data.js";
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
        // An id no test wrote gets folders that do not exist, so a removal of it removes nothing.
        const none = join(home, "none", id);
        return plugin?.folders ?? { packageFolder: none, dataFolder: none };
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

  it("removes a plugin's data folder by its id alone, and only that folder", async () => {
    const plugin = await writeFixturePlugin(bundles.folder, { id: "keeps-data", tools: ["echo"] });
    plugins.set(plugin.manifest.id, plugin);
    await writeFile(join(plugin.folders.dataFolder, "notes.json"), "{}");

    await removeLauncherData({ socket }, "keeps-data", AbortSignal.timeout(5_000));
    const left = await readdir(join(bundles.folder, "keeps-data"));

    expect(left).toStrictEqual(["package"]);
  });

  it("refuses a removal when no launcher listens, or the launcher does not say it removed", async () => {
    const none = removeLauncherData({ socket: `${socket}-none` }, "x1", AbortSignal.timeout(5_000));
    const aborted = removeLauncherData({ socket }, "keeps-data", AbortSignal.abort());

    await expect(none).rejects.toMatchObject({ code: "plugin.launcher_unreachable" });
    await expect(aborted).rejects.toMatchObject({ code: "plugin.data_not_removed" });
  });

  it("refuses an answer longer than the launcher's line, ending the connection", async () => {
    const held: Socket[] = [];
    const loud = createServer((connection) => {
      held.push(connection);
      connection.write("x".repeat(4_096));
    });
    // A socket path has a short limit on macOS, so it sits in the test's own short folder.
    const address = join(home, "loud.sock");
    await new Promise<void>((resolve) => {
      loud.listen(address, () => resolve());
    });

    // A signal that never aborts: only the cap on the answer ends the call.
    const removed = removeLauncherData(
      { socket: address },
      "keeps-data",
      new AbortController().signal,
    );
    await expect(removed).rejects.toMatchObject({ code: "plugin.data_not_removed" });
    held.forEach((connection) => connection.destroy());
    await new Promise((resolve) => {
      loud.close(resolve);
    });
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
