import { join } from "node:path";
import { createPlatform } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { engineServiceDefinition } from "./engine-service.js";

const home = join("/", "home", "owner");
const platform = createPlatform({ homeDir: home });
const entry = {
  node: join("/", "usr", "bin", "node"),
  nodeOptions: [],
  script: join("/", "opt", "binference", "main.mjs"),
};

describe("the engine's background service", () => {
  it("runs start in the foreground with the debug signal off and the run's flags, from the state folder", () => {
    const definition = engineServiceDefinition({ entry }, platform, {
      sets: ["engine.port=7460", "owner.locale=zh"],
      shutdownBudgetMs: 30_000,
    });
    expect(definition).toStrictEqual({
      name: "engine",
      description: "binference engine",
      program: entry.node,
      args: [
        "--disable-sigusr1",
        entry.script,
        "start",
        "--foreground",
        "--set",
        "engine.port=7460",
        "--set",
        "owner.locale=zh",
      ],
      workingFolder: join(home, ".binference"),
      logFile: join(home, ".binference", "logs", "service.log"),
      stopTimeoutMs: 35_000,
    });
  });

  it("keeps this run's Node options and adds the debug-signal switch once", () => {
    const options = { sets: [], shutdownBudgetMs: 30_000 };
    const loader = { ...entry, nodeOptions: ["--import", "tsx"] };
    const switched = { ...entry, nodeOptions: ["--disable-sigusr1", "--import", "tsx"] };

    expect(
      engineServiceDefinition({ entry: loader }, platform, options).args.slice(0, 3),
    ).toStrictEqual(["--disable-sigusr1", "--import", "tsx"]);
    expect(
      engineServiceDefinition({ entry: switched }, platform, options).args.slice(0, 3),
    ).toStrictEqual(["--disable-sigusr1", "--import", "tsx"]);
  });

  it("gives the OS at most 120 seconds to stop it, the most each OS waits", () => {
    const definition = engineServiceDefinition({ entry }, platform, {
      sets: [],
      shutdownBudgetMs: 300_000,
    });
    expect(definition.stopTimeoutMs).toBe(120_000);
  });
});
