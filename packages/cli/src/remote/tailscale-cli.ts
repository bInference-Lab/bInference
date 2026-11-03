import { join } from "node:path";
import { findProgram, type ProgramExit, runCommandWithin } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

/**
 * Runs Tailscale's CLI once with an argument array and answers how it ended; a run that did not
 * end within its time, or was stopped, answers exit code -1 and no output.
 */
export type RunTailscale = (args: readonly string[], signal: AbortSignal) => Promise<ProgramExit>;

const unended: ProgramExit = { exitCode: -1, stdout: "", stderr: "" };

// Each call reads or sets the local daemon's state, which answers in moments; past this the
// CLI is waiting on something, such as its link to turn HTTPS on, that binference never answers.
const callMs = 10_000;

// Tailscale's own install folders, off a background service's PATH (kb 1080): the macOS app keeps
// its CLI inside its bundle, and the Windows installer puts it in Program Files.
const tailscaleFolders: Readonly<Record<string, readonly string[]>> = {
  darwin: ["/Applications/Tailscale.app/Contents/MacOS"],
  win32: [String.raw`C:\Program Files\Tailscale`],
};

async function firstFound(folders: readonly string[]): Promise<string | undefined> {
  for (const folder of folders) {
    for (const name of ["tailscale", "Tailscale"]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the first place that holds it wins
      const found = await findProgram(join(folder, name), {});
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Tailscale's CLI as this host finds it: `tailscale` on the `PATH` of the host's environment,
 * else in the host's program folders or Tailscale's own install folder on this OS, which only the
 * entry file names, so a test reaches only a stand-in it put on that `PATH`. Answers `undefined`
 * when none holds it. Each run goes through the host's program runner, with no shell and 10
 * seconds, unless a test names a shorter `timeoutMs`.
 */
export async function findTailscale(
  host: Pick<CliHost, "env" | "programFolders" | "runProgram" | "system">,
  options: { readonly timeoutMs: number } = { timeoutMs: callMs },
): Promise<RunTailscale | undefined> {
  const own = tailscaleFolders[host.system.os] ?? [];
  const folders = host.programFolders === undefined ? [] : [...host.programFolders, ...own];
  const file = (await findProgram("tailscale", host.env)) ?? (await firstFound(folders));
  if (file === undefined) {
    return undefined;
  }
  const run = host.runProgram ?? runCommandWithin;
  return async (args, signal) => {
    try {
      return await run(file, args, { signal, timeoutMs: options.timeoutMs });
    } catch {
      return unended;
    }
  };
}
