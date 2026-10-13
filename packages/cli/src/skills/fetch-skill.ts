import { createHash } from "node:crypto";
import { join } from "node:path";
import { err, ok, type Result } from "@binference/core";
import {
  ensurePrivateFolder,
  type FilePermissions,
  listFolderFiles,
  readFilePieces,
  runCommandWithin,
} from "@binference/platform";
import type { SkillSource } from "./skill-source.js";
import { type PackedFile, readTarGz } from "./tar-files.js";

/** Why a source gave no skill: unreachable, not the pinned text, or larger than a skill may be. */
export type FetchRefusal = "fetch_failed" | "hash_mismatch" | "too_large";

/** Where a fetch works: an empty folder of its own, which the caller removes afterwards. */
export interface FetchPlace {
  readonly work: string;
  readonly permissions: FilePermissions;
  readonly signal: AbortSignal;
}

/** Packs an npm spec into a folder as `npm pack` does; answers whether it did. */
export type NpmPack = (spec: string, destination: string, signal: AbortSignal) => Promise<boolean>;

/** The most a skill may hold (decision 0207). */
export const skillLimits: { readonly files: number; readonly bytes: number } = {
  files: 200,
  bytes: 2 * 1024 * 1024,
};

// A clone or a pack may take a while on a slow link; neither may prompt for anything.
const fetchTimeoutMs = 120_000;
const quiet = { GIT_TERMINAL_PROMPT: "0" };

async function git(args: readonly string[], signal: AbortSignal) {
  return runCommandWithin("git", args, { signal, timeoutMs: fetchTimeoutMs, env: quiet });
}

// Reads a file's bytes, giving up once the skill's total would pass its limit.
async function readBytes(path: string, room: number, signal: AbortSignal) {
  const pieces: Uint8Array[] = [];
  let size = 0;
  for await (const piece of readFilePieces(path, { signal })) {
    size += piece.byteLength;
    if (size > room) {
      return undefined;
    }
    pieces.push(piece);
  }
  return new Uint8Array(Buffer.concat(pieces));
}

async function readFolder(
  folder: string,
  signal: AbortSignal,
): Promise<Result<readonly PackedFile[], FetchRefusal>> {
  const paths = (await listFolderFiles(folder, signal)).filter(
    (path) => !path.split("/").includes(".git"),
  );
  if (paths.length > skillLimits.files) {
    return err("too_large");
  }
  const files: PackedFile[] = [];
  let room = skillLimits.bytes;
  for (const path of paths) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each read counts against the room left
    const bytes = await readBytes(join(folder, path), room, signal);
    if (bytes === undefined) {
      return err("too_large");
    }
    room -= bytes.byteLength;
    files.push({ path, bytes });
  }
  return ok(files);
}

/**
 * Fetches a skill from git at its pinned commit: a clone with no checkout, no template and so no
 * hooks, over `https`, `ssh` or `file` only, that never prompts; then a checkout of that commit,
 * whose `HEAD` must be the commit. A clone that fails is `fetch_failed`; a commit the repository
 * lacks, or a `HEAD` that differs, `hash_mismatch`. Answers the files of the skill's folder.
 */
export async function fetchGitSkill(
  source: Extract<SkillSource, { kind: "git" }>,
  place: FetchPlace,
): Promise<Result<readonly PackedFile[], FetchRefusal>> {
  const { signal } = place;
  const repo = join(place.work, "repo");
  const noHooks = ["-c", `core.hooksPath=${join(place.work, "no-hooks")}`];
  const safety = ["-c", "protocol.ext.allow=never", ...noHooks];
  const clone = ["clone", "--no-checkout", "--template=", "--quiet", "--", source.url, repo];
  if ((await git([...safety, ...clone], signal)).exitCode !== 0) {
    return err("fetch_failed");
  }
  const checkout = ["checkout", "--quiet", "--detach", source.commit];
  const checkedOut = await git(["-C", repo, ...safety, ...checkout], signal);
  const head = await git(["-C", repo, "rev-parse", "HEAD"], signal);
  if (checkedOut.exitCode !== 0 || head.stdout.trim() !== source.commit) {
    return err("hash_mismatch");
  }
  return readFolder(join(repo, source.folder ?? ""), signal);
}

/** Packs an npm spec with the npm client, running no package script. */
const npmPack: NpmPack = async (spec, destination, signal) => {
  const args = ["pack", spec, "--pack-destination", destination, "--ignore-scripts", "--silent"];
  const exit = await runCommandWithin("npm", args, {
    signal,
    timeoutMs: fetchTimeoutMs,
    env: quiet,
  });
  return exit.exitCode === 0;
};

/** The Subresource Integrity of bytes, as npm publishes it: `sha512-` and the base64 digest. */
export function sha512Integrity(bytes: Uint8Array): string {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

// The files below the package's top folder (`package/` as npm packs it) and the skill's folder.
function skillFiles(
  files: readonly PackedFile[],
  folder: string | undefined,
): readonly PackedFile[] {
  const prefix = folder === undefined ? "" : `${folder}/`;
  return files.flatMap((file) => {
    const inner = file.path.slice(file.path.indexOf("/") + 1);
    return inner.startsWith(prefix) && file.path.includes("/")
      ? [{ path: inner.slice(prefix.length), bytes: file.bytes }]
      : [];
  });
}

/**
 * Fetches a skill from npm at its pinned version: `npm pack` downloads the tarball, whose own
 * SHA-512 must be the pinned integrity, and the tarball is read in memory (`readTarGz`). A pack
 * that fails is `fetch_failed`, another digest `hash_mismatch`, and a tarball with a link or a
 * path outside it `fetch_failed`. Answers the files of the skill's folder in the package.
 */
export async function fetchNpmSkill(
  source: Extract<SkillSource, { kind: "npm" }>,
  place: FetchPlace & { readonly pack?: NpmPack },
): Promise<Result<readonly PackedFile[], FetchRefusal>> {
  const { signal } = place;
  const packed = join(place.work, "pack");
  await ensurePrivateFolder(packed, place);
  const isPacked = await (place.pack ?? npmPack)(source.spec, packed, signal);
  const tarball = (await listFolderFiles(packed, signal)).find((name) => name.endsWith(".tgz"));
  if (!isPacked || tarball === undefined) {
    return err("fetch_failed");
  }
  const bytes = await readBytes(join(packed, tarball), 4 * skillLimits.bytes, signal);
  if (bytes === undefined) {
    return err("too_large");
  }
  if (sha512Integrity(bytes) !== source.integrity) {
    return err("hash_mismatch");
  }
  const files = readTarGz(bytes);
  if (!files.ok) {
    return err(files.error === "too_large" ? "too_large" : "fetch_failed");
  }
  return ok(skillFiles(files.value, source.folder));
}
