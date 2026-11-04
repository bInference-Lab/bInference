import { basename, dirname } from "node:path";
import { holdsRunningFiles, runCommandWithin } from "@binference/platform";
import type { CliHost } from "../program/cli-host.js";
import { removeScriptInstall, type ScriptInstall, scriptInstallOf } from "./script-install.js";

/** The npm package binference ships as, and where npm keeps its global packages. */
const packageName = "binference";
// npm takes moments to remove a package; past this the owner removes it by hand.
const removeBudgetMs = 120_000;

/**
 * How the program left this machine, or why it did not. `script` names what the install script put
 * in place, when it installed the program.
 */
export type ProgramRemoval =
  | { readonly kind: "removed"; readonly script?: ScriptInstall }
  /** The owner removes it with `command` once this process has exited. */
  | { readonly kind: "by_hand"; readonly command: string; readonly script?: ScriptInstall }
  /** npm, or removing the script's parts, failed; the owner runs `command`. */
  | { readonly kind: "failed"; readonly command: string; readonly script?: ScriptInstall }
  /** It runs from a folder npm did not install, such as a checkout; nothing was removed. */
  | { readonly kind: "not_npm"; readonly folder: string };

/**
 * The npm prefix of a global install the entry script runs from: `<prefix>/lib/node_modules/
 * binference` on macOS and Linux, `<prefix>\node_modules\binference` on Windows, the script in its
 * `dist/`; `undefined` for a script in any other folder, such as a checkout.
 */
export function npmPrefixOf(script: string): string | undefined {
  const packageFolder = dirname(dirname(script));
  const modules = dirname(packageFolder);
  if (basename(packageFolder) !== packageName || basename(modules) !== "node_modules") {
    return undefined;
  }
  const above = dirname(modules);
  return basename(above) === "lib" ? dirname(above) : above;
}

// `npm uninstall --global --prefix <prefix> binference`, or its command when the OS holds the files.
async function removeWithNpm(
  host: CliHost,
  prefix: string,
  signal: AbortSignal,
): Promise<ProgramRemoval> {
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

/**
 * Removes the program this process runs, when npm installed it globally, as every install path
 * does. After the install script, it removes what the script put in its data folder: the npm
 * prefix, the Node it installed and the launcher (decision 0358). Otherwise it runs
 * `npm uninstall --global --prefix <prefix> binference` with the prefix it was installed under.
 * On an OS that holds a running program's files, the owner runs the command once this process has
 * exited. A program run from any other folder is left as it is.
 */
export async function removeProgram(host: CliHost, signal: AbortSignal): Promise<ProgramRemoval> {
  const { script } = host.entry;
  const prefix = npmPrefixOf(script);
  if (prefix === undefined) {
    return { kind: "not_npm", folder: dirname(dirname(script)) };
  }
  const install = await scriptInstallOf(prefix, host.system, signal);
  if (install === undefined) {
    return removeWithNpm(host, prefix, signal);
  }
  return { ...(await removeScriptInstall(install, host.system, signal)), script: install };
}
