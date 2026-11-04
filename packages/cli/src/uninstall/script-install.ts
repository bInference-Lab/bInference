import { basename, dirname, join } from "node:path";
import {
  fileSize,
  holdsRunningFiles,
  listFolderFiles,
  readTextFile,
  removePath,
  type SystemFacts,
} from "@binference/platform";

/**
 * What the install script put in its data folder (decision 0357), which `binference uninstall`
 * removes (decision 0358): the npm prefix `npm/`, the pinned Node in `node/` when it installed
 * one, and the launcher in `bin/`. Nothing else in the folder is the script's.
 */
export interface ScriptInstall {
  /** The data folder, such as `~/.local/share/binference`. */
  readonly folder: string;
  /** The launcher's folder, the one the owner put on PATH. */
  readonly bin: string;
  /** Whether the script installed the Node binference runs with. */
  readonly hasNode: boolean;
  /** What the script put there, in the order they go: the prefix, the Node, the launcher. */
  readonly parts: readonly string[];
}

/** How removing the script's parts went: done, left for the owner on Windows, or failed. */
export type ScriptRemoval =
  | { readonly kind: "removed" }
  | { readonly kind: "by_hand" | "failed"; readonly command: string };

// The line the install script writes near the top of every launcher it writes.
const launcherMark = "Written by the binference installer";

/**
 * The install script's parts when the npm `prefix` the program runs from is the `npm/` folder of
 * its data folder and the launcher beside it is one the script wrote; `undefined` for any other
 * install, which npm alone removes.
 */
export async function scriptInstallOf(
  prefix: string,
  system: Pick<SystemFacts, "os">,
  signal: AbortSignal,
): Promise<ScriptInstall | undefined> {
  const folder = dirname(prefix);
  if (basename(prefix) !== "npm" || basename(folder) !== "binference") {
    return undefined;
  }
  const windows = system.os === "win32";
  const bin = join(folder, "bin");
  const launcher = join(bin, windows ? "binference.cmd" : "binference");
  const read = await readTextFile(launcher, signal);
  if (!read.ok || !read.value.includes(launcherMark)) {
    return undefined;
  }
  const node = join(folder, "node");
  const nodeFile = windows
    ? join(node, "current", "node.exe")
    : join(node, "current", "bin", "node");
  const hasNode = (await fileSize(nodeFile, signal)).ok;
  return { folder, bin, hasNode, parts: [prefix, ...(hasNode ? [node] : []), launcher] };
}

// A path quoted for PowerShell, and for a POSIX shell.
function quoted(path: string): string {
  return `'${path.replaceAll("'", "''")}'`;
}

function shellQuoted(path: string): string {
  return `'${path.replaceAll("'", String.raw`'\''`)}'`;
}

// PowerShell removes the parts once this process ended, then each folder left empty.
function removalCommand(install: ScriptInstall): string {
  const empty = (folder: string) =>
    `if (-not (Get-ChildItem -Force -LiteralPath ${quoted(folder)})) ` +
    `{ Remove-Item -LiteralPath ${quoted(folder)} }`;
  const parts = install.parts.map(quoted).join(", ");
  return [
    `Remove-Item -Recurse -Force -LiteralPath ${parts}`,
    empty(install.bin),
    empty(install.folder),
  ].join("; ");
}

// A folder goes only once it holds no file: the owner may keep their own there.
async function removeIfEmpty(folder: string, signal: AbortSignal): Promise<void> {
  if ((await listFolderFiles(folder, signal)).length === 0) {
    await removePath(folder, signal);
  }
}

/**
 * Removes what the install script put in place, then the launcher's folder and the data folder
 * when nothing is left in them. A Node or npm the machine had stays: only the data folder's own
 * Node goes. On an OS that holds a running program's files, it removes nothing and answers the
 * PowerShell command the owner runs once this process has exited.
 */
export async function removeScriptInstall(
  install: ScriptInstall,
  system: Pick<SystemFacts, "os">,
  signal: AbortSignal,
): Promise<ScriptRemoval> {
  if (holdsRunningFiles(system)) {
    return { kind: "by_hand", command: removalCommand(install) };
  }
  try {
    for (const part of install.parts) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- the launcher goes last, once the program is gone
      await removePath(part, signal);
    }
    await removeIfEmpty(install.bin, signal);
    await removeIfEmpty(install.folder, signal);
    return { kind: "removed" };
  } catch {
    return { kind: "failed", command: `rm -rf ${install.parts.map(shellQuoted).join(" ")}` };
  }
}
