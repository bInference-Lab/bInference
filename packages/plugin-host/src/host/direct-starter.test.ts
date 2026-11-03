import { join } from "node:path";
import process from "node:process";
import { createManualClock } from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pluginStarterContract } from "../contracts/plugin-starter-contract.js";
import { writeFixturePlugin } from "../testing/fixture-plugins.js";
import { testMemoryWatch } from "../testing/memory-watch.js";
import { buildPluginBundles, type PluginBundles } from "../testing/plugin-bundles.js";
import { createDirectStarter } from "./direct-starter.js";

let bundles: PluginBundles;
let made = 0;

beforeAll(async () => {
  bundles = await buildPluginBundles("starter-");
}, 120_000);

afterAll(async () => {
  await bundles.remove();
}, 60_000);

describe("createDirectStarter", { timeout: 60_000 }, () => {
  it.each(
    pluginStarterContract({
      create: async () => {
        made += 1;
        const plugin = await writeFixturePlugin(bundles.folder, {
          id: `echo-${String(made)}`,
          tools: ["echo"],
        });
        return {
          starter: createDirectStarter({
            program: bundles.program,
            parentEnv: process.env,
            memory: testMemoryWatch(createManualClock()),
          }),
          launch: { id: plugin.manifest.id, folders: plugin.folders },
          entry: join(plugin.folders.packageFolder, plugin.manifest.entry),
        };
      },
    }),
  )("follows the PluginStarter contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("runs plugins under the engine's own user", () => {
    expect(
      createDirectStarter({
        program: "plugin-process.mjs",
        parentEnv: {},
        memory: testMemoryWatch(createManualClock()),
      }).ownUser,
    ).toBe(false);
  });
});
