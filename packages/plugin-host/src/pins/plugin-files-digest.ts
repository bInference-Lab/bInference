import { createHash } from "node:crypto";
import { join } from "node:path";
import { err, ok, type Result } from "@binference/core";
import { findFolderStrays, listFolderFiles, readFilePieces } from "@binference/platform";

/** One file of a plugin's package: its path inside it, with `/` between parts, and its bytes. */
export interface PluginFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Why a plugin's installed files are not the ones its pin names. */
export type PinRefusal = "links" | "files_changed";

const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

// Paths sort by their UTF-16 code units, as `listFolderFiles` sorts them, so the order never
// depends on the locale.
function byPath(a: { readonly path: string }, b: { readonly path: string }): number {
  if (a.path === b.path) {
    return 0;
  }
  return a.path < b.path ? -1 : 1;
}

/**
 * The SHA-256 of a plugin's files, as 64 lowercase hex digits (decision 0348): of one line per
 * file in the order of its path, the path, a NUL, the hex SHA-256 of its bytes and a line feed.
 * A path holds neither a NUL nor a line feed, which the install refuses, so two sets of files
 * never share the text.
 */
export function pluginFilesDigest(
  files: readonly { readonly path: string; readonly sha256: string }[],
): string {
  const lines = files.toSorted(byPath).map(({ path, sha256 }) => `${path}\u0000${sha256}\n`);
  return sha256Hex(lines.join(""));
}

/** {@link pluginFilesDigest} of files held in memory. */
export function digestOfFiles(files: readonly PluginFile[]): string {
  return pluginFilesDigest(files.map(({ path, bytes }) => ({ path, sha256: sha256Hex(bytes) })));
}

async function fileSha256(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  for await (const piece of readFilePieces(path, { signal })) {
    hash.update(piece);
  }
  return hash.digest("hex");
}

/**
 * Checks a plugin's installed folder against its pin before each start (decisions 0343 and
 * 0348): `links` when the folder holds a link, a second hard link, or anything but folders and
 * plain files, so nothing outside it comes in; `files_changed` when its files do not hash to
 * `pinned`. A folder that is not there is `files_changed`.
 */
export async function checkPluginFiles(
  folder: string,
  pinned: string,
  signal: AbortSignal,
): Promise<Result<void, PinRefusal>> {
  const strays = await findFolderStrays(folder, signal).catch(() => undefined);
  if (strays === undefined) {
    return err("files_changed");
  }
  if (strays.length > 0) {
    return err("links");
  }
  const paths = await listFolderFiles(folder, signal);
  const files = [];
  for (const path of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time bounds what is read
    files.push({ path, sha256: await fileSha256(join(folder, path), signal) });
  }
  return pluginFilesDigest(files) === pinned ? ok(undefined) : err("files_changed");
}
