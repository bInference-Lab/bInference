import { dirname, join } from "node:path";
import type { Random } from "@binference/core";
import {
  ensureReadableFolder,
  movePath,
  removePath,
  writeReadableFile,
} from "@binference/platform";
import type { PluginFile } from "@binference/plugin-host";

/**
 * Where installed plugins live: the folder of each plugin's package by its id, and a folder on the
 * same disk for installs under way. Outside the image both sit in the state folder's `plugins/`;
 * in the image, in the plugins' volume, which the plugin user reads (decision 0344).
 */
export interface PluginShelf {
  readonly packages: string;
  readonly work: string;
}

// The files go in one at a time, each readable by the plugin's own OS user where it has one.
async function writeFiles(
  folder: string,
  files: readonly PluginFile[],
  signal: AbortSignal,
): Promise<void> {
  for (const file of files) {
    const path = join(folder, file.path);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file after another keeps the writes in order
    await ensureReadableFolder(dirname(path), signal);
    // oxlint-disable-next-line eslint/no-await-in-loop -- as above
    await writeReadableFile(path, file.bytes, signal);
  }
}

/**
 * Puts a plugin's files in `packages/<id>` (decision 0348): written whole in a work folder beside
 * it, then moved in place of the package there, which leaves with the work folder. A failure
 * leaves the installed package as it was, moved back when the new one did not move in; the work
 * folder goes either way. The caller stops the
 * plugin's process first, so nothing reads the folder as it moves.
 */
export async function putPluginInPlace(
  shelf: PluginShelf & { readonly random: Random },
  plugin: { readonly id: string; readonly files: readonly PluginFile[] },
  signal: AbortSignal,
): Promise<void> {
  const work = join(shelf.work, `plugin-${Buffer.from(shelf.random.bytes(8)).toString("hex")}`);
  try {
    const ready = join(work, "package");
    await writeFiles(ready, plugin.files, signal);
    await ensureReadableFolder(shelf.packages, signal);
    const target = join(shelf.packages, plugin.id);
    const replaced = join(work, "replaced");
    await movePath(target, replaced, signal);
    try {
      await movePath(ready, target, signal);
    } catch (error) {
      await movePath(replaced, target, AbortSignal.timeout(30_000));
      throw error;
    }
  } finally {
    // The work folder goes even when the install was stopped.
    await removePath(work, AbortSignal.timeout(30_000));
  }
}

/** Removes a plugin's package from the shelf; a package that is not there is none. */
export async function removePluginPackage(
  shelf: PluginShelf,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  await removePath(join(shelf.packages, id), signal);
}
