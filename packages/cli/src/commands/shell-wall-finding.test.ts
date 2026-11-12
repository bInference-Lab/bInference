import { createManualClock } from "@binference/core/testing";
import { createFormatter } from "@binference/i18n";
import type { CommandWallState, ShellEnd, ShellLaunch, ShellLauncher } from "@binference/platform";
import { describe, expect, it } from "vitest";
import type { CheckFinding } from "./check-finding.js";
import { shellWallFinding } from "./shell-wall-finding.js";

const clock = createManualClock();
const signal = new AbortController().signal;
const english = createFormatter({ locale: "en", timeZone: "UTC" });

// What the finding's message and its lines say in English.
function wordsOf(finding: CheckFinding): readonly string[] {
  const lines = [
    ...(finding.message === undefined ? [] : [finding.message]),
    ...(finding.more ?? []),
  ];
  return lines.map(({ key, values }) => english.message(`cli.${key}`, values));
}

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
      message: { key: "check.shellWall.none", values: { cause: "missing" } },
      more: [{ key: "check.shellWall.fixNone", values: { cause: "missing" } }],
      details: { wall: "none", cause: "missing" },
    });
  });

  it("names namespaces bubblewrap is refused and the next step where it cannot run", async () => {
    const { run } = launcherOf({
      kind: "none",
      cause: "refused",
      reason: "bubblewrap could not run a command here",
    });

    const finding = await shellWallFinding(run);

    expect(finding).toMatchObject({ level: "warn", details: { wall: "none", cause: "refused" } });
    expect(wordsOf(finding)).toStrictEqual([
      "The agent cannot run commands on this machine: bubblewrap is installed, but the machine " +
        "refuses it the user namespaces it walls commands with.",
      "Allow unprivileged user namespaces, so bubblewrap can run, or run binference in its " +
        "Docker image, which runs the agent's commands as a user of their own.",
    ]);
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
