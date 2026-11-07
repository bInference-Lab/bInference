import assert from "node:assert/strict";
import { commandRunnerContract } from "@binference/engine/testing";
import type { ShellLaunch, ShellLauncher } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { commandRunnerOf } from "./compose-shell.js";

const config = configSchema.parse({
  version: currentConfigVersion,
  telegram: { botToken: { fromEnv: "TEST_BOT_TOKEN" } },
});

const env = {
  PATH: "/usr/bin:/bin",
  HOME: "/home/owner",
  TEST_BOT_TOKEN: "123:secret",
  BINFERENCE_HOME: "/srv/binference",
  BINFERENCE_INIT_MODEL_KEY: "key",
};

// A launcher that records each launch and ends it at once with exit code 0.
function recordingLauncher(wall: ShellLauncher["wall"]) {
  const launches: ShellLaunch[] = [];
  const launcher: ShellLauncher = {
    wall,
    start(launch, onOutput) {
      launches.push(launch);
      onOutput(`${launch.command}\n`);
      return {
        ended: Promise.resolve({ exitCode: 0, timedOut: false, stopped: false }),
        stop() {},
      };
    },
  };
  return { launcher, launches };
}

describe("the agent's command runner", () => {
  let home: TempFolder;
  beforeEach(async () => {
    home = await createTempFolder("shell-home-");
  });
  afterEach(async () => {
    await home.remove();
  });

  it.each(
    commandRunnerContract({
      create: async () =>
        Promise.resolve({
          runner: commandRunnerOf({
            launcher: recordingLauncher({ kind: "held" }).launcher,
            env,
            homeDir: home.path,
            config: () => config,
          }),
          folder: home.path,
          printsHello: "hello",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("starts in the home folder with no binference variable and no secret's variable", async () => {
    const { launcher, launches } = recordingLauncher({ kind: "held" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const started = runner.start({ command: "ls -l", timeoutMs: 1_000 }, () => undefined);
    assert.ok(started.ok);
    expect(await started.value.ended).toStrictEqual({
      exitCode: 0,
      timedOut: false,
      stopped: false,
    });
    expect(launches).toStrictEqual([
      {
        command: "ls -l",
        folder: home.path,
        timeoutMs: 1_000,
        env: { PATH: "/usr/bin:/bin", HOME: "/home/owner" },
      },
    ]);
  });

  it("refuses a folder that does not exist, and starts nothing", () => {
    const { launcher, launches } = recordingLauncher({ kind: "held" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const started = runner.start({ command: "ls", folder: "gone", timeoutMs: 0 }, () => undefined);
    expect([started, launches]).toStrictEqual([{ ok: false, error: "folder_missing" }, []]);
  });

  it("refuses every command where the wall cannot hold", () => {
    const { launcher, launches } = recordingLauncher({ kind: "none", reason: "no bubblewrap" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const started = runner.start({ command: "ls", timeoutMs: 0 }, () => undefined);
    expect([started, launches]).toStrictEqual([{ ok: false, error: "no_wall" }, []]);
  });

  it("hides a recovery phrase in what a command prints", () => {
    const { launcher } = recordingLauncher({ kind: "held" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const phrase = "abandon ".repeat(11) + "about";
    expect(runner.mask(`qzx: ${phrase}\n`)).toBe("qzx: [recovery phrase hidden]\n");
  });
});
