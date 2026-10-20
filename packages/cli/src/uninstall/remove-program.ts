import { basename, dirname } from "node:path";
import { holdsRunningFiles, runCommandWithin } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";

/** The npm package binference ships as, and where npm keeps its global packages. */
const packageName = "binference";
// npm takes moments to remove a package; past this the owner removes it by hand.
const removeBudgetMs = 120_000;

/** How the program left this machine, or why it did not. */
export type ProgramRemoval =
  | { readonly kind: "removed" }
  /** The owner removes it with `command` once this process has exited. */
  | { readonly kind: "by_hand"; readonly command: string }
  /** npm failed; the owner runs `command`. */
  | { readonly kind: "failed"; readonly command: string }
  /** It runs from a folder npm did not install, such as a checkout; nothing was removed. */
  | { readonly kind: "not_npm"; readonly folder: string };

// The npm prefix of a global install: `<prefix>/lib/node_modules/binference` on macOS and Linux,
// `<prefix>\node_modules\binference` on Windows. The entry script sits in its `dist/`.
function npmPrefixOf(script: string): string | undefined {
  const packageFolder = dirname(dirname(script));
  const modules = dirname(packageFolder);
  if (basename(packageFolder) !== packageName || basename(modules) !== "node_modules") {
    return undefined;
  }
  const above = dirname(modules);
  return basename(above) === "lib" ? dirname(above) : above;
}

/**
 * Removes the program this process runs, when npm installed it globally, as every install path
 * does: `npm uninstall --global --prefix <prefix> binference` with the prefix it was installed
 * under. On an OS that holds a running program's files, the owner runs the command once this
 * process has exited. A program run from any other folder is left as it is.
 */
export async function removeProgram(host: CliHost, signal: AbortSignal): Promise<ProgramRemoval> {
  const { script } = host.entry;
  const prefix = npmPrefixOf(script);
  if (prefix === undefined) {
    return { kind: "not_npm", folder: dirname(dirname(script)) };
  }
  const command = `npm uninstall --global ${packageName}`;
  if (holdsRunningFiles(host.system)) {
    return { kind: "by_hand", command };
  }
  const run = host.runProgram ?? runCommandWithin;
  const args = ["uninstall", "--global", "--prefix", prefix, packageName];
  try {
    const exit = await run("npm", args, { signal, timeoutMs: removeBudgetMs });
    return exit.exitCode === 0 ? { kind: "removed" } : { kind: "failed", command };
  } catch {
    return { kind: "failed", command };
  }
}
