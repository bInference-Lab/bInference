import { createManualClock } from "@binference/core/testing";
import type { CommandWallState, ShellEnd, ShellLaunch, ShellLauncher } from "@binference/platform";
import { describe, expect, it } from "vitest";
import { shellWallFinding } from "./shell-wall-finding.js";

const clock = createManualClock();
const signal = new AbortController().signal;

// A launcher whose wall a check finds as given, which ends each command as `end` says and
// records it.
function launcherOf(
  checked: CommandWallState,
  options: { readonly home?: string; readonly end?: ShellEnd } = {},
) {
  const launches: ShellLaunch[] = [];
  const seen: { state: CommandWallState } = {
    state: { kind: "none", cause: "untried", reason: "not tried" },
  };
  const launcher: ShellLauncher = {
    wall: {
      get state() {
        return seen.state;
      },
      check: async () => {
        seen.state = checked;
        return Promise.resolve(checked);
      },
    },
    ...(options.home === undefined ? {} : { home: options.home }),
    start(launch) {
      launches.push(launch);
      const end = options.end ?? { exitCode: 0, timedOut: false, stopped: false };
      return { ended: Promise.resolve(end), stop: () => undefined };
    },
  };
  return {
    run: { host: { clock }, platform: { shellLauncher: () => launcher }, signal },
    launches,
  };
}

describe("the finding of the shell's wall", () => {
  it("names the wall its check finds holding, and runs nothing for it", async () => {
    const { run, launches } = launcherOf({ kind: "held", by: "seatbelt" });

    expect(await shellWallFinding(run)).toStrictEqual({
      check: "shell.wall",
      level: "ok",
      message: { key: "check.shellWall.held", values: { wall: "seatbelt" } },
      details: { wall: "seatbelt" },
    });
    expect(launches).toStrictEqual([]);
  });

  it("warns that every command is refused where no wall holds", async () => {
    const { run } = launcherOf({
      kind: "none",
      cause: "missing",
      reason: "bwrap is not installed",
    });

    expect(await shellWallFinding(run)).toMatchObject({
      check: "shell.wall",
      level: "warn",
      message: { key: "check.shellWall.none" },
      more: [{ key: "check.shellWall.fixNone" }],
      details: { wall: "none" },
    });
  });

  it("runs a command that does nothing in the image's shell home", async () => {
    const { run, launches } = launcherOf({ kind: "held", by: "os_user" }, { home: "/shell/home" });

    expect(await shellWallFinding(run)).toMatchObject({
      level: "ok",
      details: { wall: "os_user" },
    });
    expect(launches).toMatchObject([{ command: "true", folder: "/shell/home", env: {} }]);
  });

  it("warns when the image's shell launcher does not run that command", async () => {
    const end = { timedOut: false, stopped: false, failedToStart: "ENOENT" };
    const { run } = launcherOf({ kind: "held", by: "os_user" }, { home: "/shell/home", end });

    expect(await shellWallFinding(run)).toMatchObject({
      level: "warn",
      message: { key: "check.shellWall.launcherDown" },
      more: [{ key: "check.shellWall.fixLauncher" }],
      details: { wall: "os_user", launcher: "down" },
    });
  });
});
