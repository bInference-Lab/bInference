import type { Platform, ShellEnd, ShellLauncher } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";
import type { CheckFinding } from "./check-finding.js";

const check = "shell.wall";
// The check's own share of `binference check`'s budget: one command that does nothing.
const probeMs = 5_000;

// Runs a command that does nothing through the launcher, as the agent's commands run, and says
// whether it ended well.
async function launcherAnswers(launcher: ShellLauncher, folder: string): Promise<boolean> {
  const running = launcher.start(
    { command: "true", folder, timeoutMs: probeMs, env: {} },
    () => undefined,
  );
  const end: ShellEnd = await running.ended;
  return end.failedToStart === undefined && end.exitCode === 0;
}

/**
 * `shell.wall` (decisions 0378 and 0412): what keeps the agent's commands from binference's own
 * folder on this machine, Seatbelt, bubblewrap or, in the Docker image, a user of their own, as a
 * check of the wall finds it, so bubblewrap counts only once it ran a command. It warns when
 * nothing does, since every command is then refused, and names the cause: no mechanism here, or
 * a machine that refuses bubblewrap its namespaces, each with its next step. In the image it
 * warns when the shell launcher does not run a command that does nothing in its home, as when
 * the container started without the image entry.
 */
export async function shellWallFinding(run: {
  readonly host: Pick<CliHost, "clock">;
  readonly platform: Pick<Platform, "shellLauncher">;
  readonly signal: AbortSignal;
}): Promise<CheckFinding> {
  const launcher = run.platform.shellLauncher(run.host.clock);
  const wall = await launcher.wall.check(run.signal);
  if (wall.kind === "none") {
    const values = { cause: wall.cause };
    const message = { key: "check.shellWall.none", values };
    const more = [{ key: "check.shellWall.fixNone", values }];
    return { check, level: "warn", message, more, details: { wall: "none", ...values } };
  }
  if (launcher.home !== undefined && !(await launcherAnswers(launcher, launcher.home))) {
    const message = { key: "check.shellWall.launcherDown", values: {} };
    const more = [{ key: "check.shellWall.fixLauncher", values: {} }];
    return { check, level: "warn", message, more, details: { wall: wall.by, launcher: "down" } };
  }
  const message = { key: "check.shellWall.held", values: { wall: wall.by } };
  return { check, level: "ok", message, details: { wall: wall.by } };
}
