import assert from "node:assert/strict";
import { join } from "node:path";
import { BinferenceError } from "@binference/core";
import { createMemoryLogger } from "@binference/core/testing";
import { commandRunnerContract } from "@binference/engine/testing";
import {
  type CommandWallState,
  type Platform,
  realPathOf,
  type ShellLaunch,
  type ShellLauncher,
} from "@binference/platform";
import {
  createTempFolder,
  standInProgramsRun,
  type TempFolder,
  writeStandInProgram,
} from "@binference/platform/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentConfigVersion } from "../config/migrations/config-migrations.js";
import { configSchema } from "../config/schema/config.schema.js";
import { checkCommandWall, commandRunnerOf, shareImageWorkspace } from "./compose-shell.js";

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

// A launcher that records each launch and ends it at once with exit code 0, and whose wall a
// check finds as `checked` says.
function recordingLauncher(state: CommandWallState, checked: CommandWallState = state) {
  const launches: ShellLaunch[] = [];
  const seen = { state, checks: 0 };
  const launcher: ShellLauncher = {
    wall: {
      get state() {
        return seen.state;
      },
      check: async () => {
        seen.checks += 1;
        seen.state = checked;
        return Promise.resolve(checked);
      },
    },
    start(launch, onOutput) {
      launches.push(launch);
      onOutput(`${launch.command}\n`);
      return {
        ended: Promise.resolve({ exitCode: 0, timedOut: false, stopped: false }),
        stop() {},
      };
    },
  };
  return { launcher, launches, seen };
}

const refused: CommandWallState = {
  kind: "none",
  cause: "refused",
  reason: "bubblewrap could not make a namespace",
};

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

  it("starts in the home folder of a launcher whose commands run as a user of their own", async () => {
    const recorded = recordingLauncher({ kind: "held", by: "os_user" });
    const launcher = { ...recorded.launcher, home: home.path };
    const runner = commandRunnerOf({ launcher, env, homeDir: "/home/owner", config: () => config });
    const started = runner.start({ command: "ls", folder: "~", timeoutMs: 0 }, () => undefined);
    assert.ok(started.ok);
    await started.value.ended;
    expect(recorded.launches.map((launch) => launch.folder)).toStrictEqual([home.path]);
  });

  it("refuses a folder that does not exist, and starts nothing", () => {
    const { launcher, launches } = recordingLauncher({ kind: "held", by: "seatbelt" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const started = runner.start({ command: "ls", folder: "gone", timeoutMs: 0 }, () => undefined);
    expect([started, launches]).toStrictEqual([{ ok: false, error: "folder_missing" }, []]);
  });

  it("refuses every command where the wall cannot hold, and checks the wall again", () => {
    const { launcher, launches, seen } = recordingLauncher(refused);
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const started = runner.start({ command: "ls", timeoutMs: 0 }, () => undefined);
    expect([started, launches, seen.checks]).toStrictEqual([
      { ok: false, error: "no_wall" },
      [],
      1,
    ]);
  });

  it("runs the next command once the wall a refused command checked again holds", async () => {
    const { launcher, launches } = recordingLauncher(refused, { kind: "held", by: "bubblewrap" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const refusedStart = runner.start({ command: "ls", timeoutMs: 0 }, () => undefined);
    const next = runner.start({ command: "pwd", timeoutMs: 0 }, () => undefined);
    assert.ok(next.ok);
    await next.value.ended;
    expect([refusedStart.ok, launches.map((launch) => launch.command)]).toStrictEqual([
      false,
      ["pwd"],
    ]);
  });

  it("hides a recovery phrase in what a command prints", () => {
    const { launcher } = recordingLauncher({ kind: "held", by: "seatbelt" });
    const runner = commandRunnerOf({ launcher, env, homeDir: home.path, config: () => config });
    const phrase = "abandon ".repeat(11) + "about";
    expect(runner.mask(`qzx: ${phrase}\n`)).toBe("qzx: [recovery phrase hidden]\n");
  });
});

// A share of the image's workspace that fails, as on a folder that is not binference's.
async function shareWorkspace(): Promise<void> {
  throw new BinferenceError({ code: "platform.share_failed", message: "not binference's" });
}

// A platform whose command wall a check finds as given.
function platformWalled(checked: CommandWallState): Pick<Platform, "commandWall"> {
  return {
    commandWall: { state: checked, check: async () => Promise.resolve(checked), wrap: (l) => l },
  };
}

describe("checking the wall at start", () => {
  it("logs why no wall holds, and lets the start go on", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });

    await expect(checkCommandWall(platformWalled(refused), logger, live)).resolves.toBeUndefined();

    expect(logger.records()).toMatchObject([{ level: "warn", event: "shell.wall_refused" }]);
  });

  it("logs nothing where the wall holds", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });

    await checkCommandWall(platformWalled({ kind: "held", by: "bubblewrap" }), logger, live);

    expect(logger.records()).toStrictEqual([]);
  });
});

describe("sharing the image's workspace at start", () => {
  it("logs a workspace it cannot share, and lets the start go on", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });

    await expect(shareImageWorkspace({ shareWorkspace }, logger, live)).resolves.toBeUndefined();

    expect(logger.records()).toMatchObject([
      {
        level: "warn",
        event: "shell.workspace_unshared",
        fields: { errorCode: "platform.share_failed" },
      },
    ]);
  });

  it("does nothing outside the image", async () => {
    const logger = createMemoryLogger({ subsystem: "engine" });

    await shareImageWorkspace({}, logger, live);

    expect(logger.records()).toStrictEqual([]);
  });
});
