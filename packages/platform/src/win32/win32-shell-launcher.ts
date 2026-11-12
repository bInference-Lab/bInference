import { existsSync } from "node:fs";
import type { Clock } from "@binference/core";
import type { CommandWall, ShellLauncher } from "../ports.js";
import { runCommand } from "../run-command.js";
import type { ShellProgram } from "../shell-launch.js";
import { startWalledShell } from "../start-walled-shell.js";

// PowerShell 7 where it is installed, else the Windows PowerShell every Windows ships; never cmd.
const powerShell7 = "C:\\Program Files\\PowerShell\\7\\pwsh.exe";
const flags = ["-NoProfile", "-NonInteractive", "-Command"] as const;

// The shell a command runs in on Windows: PowerShell 7 when installed, else Windows PowerShell.
function win32ShellProgram(): ShellProgram {
  return { file: existsSync(powerShell7) ? powerShell7 : "powershell.exe", args: flags };
}

// Windows has no process groups to signal; taskkill ends a process and every process it started.
function endTree(pid: number): void {
  void runCommand("taskkill", ["/pid", String(pid), "/T", "/F"], AbortSignal.timeout(10_000)).catch(
    () => undefined,
  );
}

/**
 * Runs the agent's commands on Windows in PowerShell, behind the command wall. Windows has no wall
 * in v1, so every start throws `platform.no_wall` until one is built.
 */
export function createWin32ShellLauncher(wall: CommandWall, clock: Clock): ShellLauncher {
  const program = win32ShellProgram();
  return {
    wall,
    start: (launch, onOutput) =>
      startWalledShell(launch, { program, wall, clock, ownGroup: false, endTree }, onOutput),
  };
}
