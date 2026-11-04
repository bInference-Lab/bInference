import { runCommandWithin } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

// npm fetches the package's outside dependencies; on a slow line that takes minutes.
const installBudgetMs = 10 * 60_000;

/** The npm command line that installs a kept tarball into the global prefix, for the owner too. */
export function installArgs(prefix: string, tarball: string): readonly string[] {
  return [
    "install",
    "--global",
    "--prefix",
    prefix,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    tarball,
  ];
}

/**
 * Installs a verified tarball kept on this machine into the npm prefix this binference runs from
 * (decision 0356): npm installs that file, never a name it resolves again, and runs no install
 * script; it reaches npm's registry for the package's outside dependencies by the owner's proxy.
 * Answers whether npm succeeded.
 */
export async function installTarball(
  host: CliHost,
  install: {
    readonly prefix: string;
    readonly tarball: string;
    /** The variables npm runs with on top of this process's: the owner's proxy setting. */
    readonly env: Readonly<Record<string, string | undefined>>;
  },
  signal: AbortSignal,
): Promise<boolean> {
  const run = host.runProgram ?? runCommandWithin;
  try {
    const exit = await run("npm", installArgs(install.prefix, install.tarball), {
      signal,
      timeoutMs: installBudgetMs,
      env: install.env,
    });
    return exit.exitCode === 0;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}
