import assert from "node:assert/strict";
import { join } from "node:path";
import { commandRunnerContract } from "@binference/engine/testing";
import { realPathOf, type ShellLaunch, type ShellLauncher } from "@binference/platform";
import {
  createTempFolder,
  standInProgramsRun,
  type TempFolder,
  writeStandInProgram,
} from "@binference/platform/testing";
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

// The file a stand-in program named `tool` is, and a signal no test aborts.
const toolFile = standInProgramsRun ? "tool" : "tool.cmd";
const live = new AbortController().signal;

// The real path of a file the test made, which must be there.
async function realOf(path: string): Promise<string> {
  const real = await realPathOf(path, live);
  if (real === undefined) {
    throw new Error(`${path} is not there`);
  }
  return real;
}

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
      create: async () => {
        await writeStandInProgram(home.path, "tool", "");
        return {
          runner: commandRunnerOf({
            launcher: recordingLauncher({ kind: "held", by: "seatbelt" }).launcher,
            env: { ...env, PATH: home.path },
            homeDir: home.path,
            config: () => config,
          }),
          folder: home.path,
          realFolder: await realOf(home.path),
          printsHello: "hello",
          program: {
            name: "tool",
            path: await realOf(join(home.path, toolFile)),
          },
        };
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("starts in the home folder with no binference variable and no secret's variable", async () => {
    const { launcher, launches } = recordingLauncher({ kind: "held", by: "seatbelt" });
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
    const { launcher, launches } = recordingLauncher({ kind: "held", by: "seatbelt" });
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
    const { launcher } = recordingLauncher({ kind: "held", by: "seatbelt" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const phrase = "abandon ".repeat(11) + "about";
    expect(runner.mask(`qzx: ${phrase}\n`)).toBe("qzx: [recovery phrase hidden]\n");
  });
});
