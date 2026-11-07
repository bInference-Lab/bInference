import { existsSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import type { Clock } from "@binference/core";
import type { CommandWall, ShellLauncher } from "../ports.js";
import type { ShellProgram } from "../shell-launch.js";
import { type EndForce, startWalledShell } from "../start-walled-shell.js";

// A login shell that refuses commands, or one whose syntax few commands are written for, gives
// way to these, in order.
const refusedShells = new Set(["false", "nologin", "fish"]);
const fallbackShells = ["/bin/bash", "/bin/sh"] as const;

// Each shell is told to skip the owner's startup files, so a command runs the same each time.
function flagsOf(file: string): readonly string[] {
  const name = basename(file);
  if (name === "bash") {
    return ["--noprofile", "--norc", "-c"];
  }
  return name === "zsh" ? ["-f", "-c"] : ["-c"];
}

/**
 * The shell a command runs in on macOS and Linux: the owner's login shell when it is an absolute
 * path that exists and is not `false`, `nologin` or `fish`, else bash, else sh. It never starts as
 * a login shell.
 */
export function posixShellProgram(loginShell: string | undefined): ShellProgram {
  const own =
    loginShell !== undefined &&
    isAbsolute(loginShell) &&
    existsSync(loginShell) &&
    !refusedShells.has(basename(loginShell))
      ? loginShell
      : undefined;
  const file = own ?? fallbackShells.find((path) => existsSync(path)) ?? "/bin/sh";
  return { file, args: flagsOf(file) };
}

// The command leads its own process group, so the group's number ends everything it started.
function endGroup(pid: number, force: EndForce): void {
  try {
    process.kill(-pid, force === "force" ? "SIGKILL" : "SIGTERM");
  } catch {
    // The group already ended.
  }
}

/**
 * Runs the agent's commands on macOS and Linux in the owner's shell, behind the command wall, each
 * in a process group of its own so a stop or time limit ends everything it started.
 */
export function createPosixShellLauncher(
  wall: CommandWall,
  options: { readonly loginShell: string | undefined; readonly clock: Clock },
): ShellLauncher {
  const { loginShell, clock } = options;
  const program = posixShellProgram(loginShell);
  return {
    wall: wall.state,
    start: (launch, onOutput) =>
      startWalledShell(
        launch,
        { program, wall, clock, ownGroup: true, endTree: endGroup },
        onOutput,
      ),
  };
}
