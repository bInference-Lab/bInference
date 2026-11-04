import { join } from "node:path";
import {
  ensurePrivateFolder,
  fileSize,
  type FilePermissions,
  listFolderFiles,
  readFilePieces,
  readTextFile,
  removePath,
  type StateFolder,
  writePrivateFile,
  writePrivateStream,
} from "@binference/platform";
import { z } from "zod";
import { fileSha256 } from "../state/file-sha256.js";
import { updatesFolderOf } from "./announced-update.js";

/** What the kept files are written with: the state folder, this OS's permissions, a deadline. */
export interface KeptFilesRun {
  readonly stateFolder: StateFolder;
  readonly permissions: FilePermissions;
  readonly signal: AbortSignal;
}

/**
 * How putting the kept state back went: done, no complete copy to put back, or a copy that is not
 * the one the update made.
 */
export type RestoreOutcome = "restored" | "missing" | "changed";

// SQLite's files beside a database: its write-ahead log and the log's index.
const companions = ["-wal", "-shm"];

/** One copied file: its name in the state folder and the SHA-256 of its copy. */
interface CopiedFile {
  readonly name: string;
  readonly sha256: string;
}

const copiesSchema: z.ZodType<{ readonly files: readonly CopiedFile[] }> = z.object({
  files: z.array(z.object({ name: z.string().min(1), sha256: z.string().length(64) })),
});

const tarballName = /^binference-[^/]+\.tgz$/;

/** Where a release's verified tarball is kept for the update's length. */
export function keptTarballOf(stateRoot: string, version: string): string {
  return join(updatesFolderOf(stateRoot), `binference-${version}.tgz`);
}

function rollbackFolderOf(stateRoot: string): string {
  return join(updatesFolderOf(stateRoot), "rollback");
}

// The list of copies, written last, so a list is there only once every copy is.
function copiesListOf(stateRoot: string): string {
  return join(rollbackFolderOf(stateRoot), "copies.json");
}

// Each file the copy holds, by its name in the state folder: the two databases, each with its log
// and the log's index, then config.json5, which a new version's config migration may change.
function keptNamesOf(stateFolder: StateFolder): readonly (readonly string[])[] {
  const nameOf = (file: string) => file.slice(stateFolder.root.length + 1);
  const database = (file: string) => [nameOf(file), ...companions.map((end) => nameOf(file) + end)];
  return [
    database(stateFolder.engineDatabase),
    database(stateFolder.agentDatabase),
    [nameOf(stateFolder.configFile)],
  ];
}

/** Keeps a verified tarball owner-only in `updates/`; answers where. */
export async function keepTarball(
  run: KeptFilesRun,
  release: { readonly version: string; readonly bytes: Uint8Array },
): Promise<string> {
  await ensurePrivateFolder(updatesFolderOf(run.stateFolder.root), run);
  const file = keptTarballOf(run.stateFolder.root, release.version);
  await writePrivateFile(file, release.bytes, run);
  return file;
}

async function copyFile(from: string, to: string, run: KeptFilesRun): Promise<void> {
  await writePrivateStream(to, readFilePieces(from, { signal: run.signal }), run);
}

async function isThere(file: string, signal: AbortSignal): Promise<boolean> {
  return (await fileSize(file, signal)).ok;
}

/**
 * Copies the stopped engine's state owner-only into `updates/rollback/`, in place of an earlier
 * copy: `engine.sqlite` and `agent.sqlite` with any log beside them, and `config.json5`. The list
 * of copies, with the SHA-256 of each, is written last. The engine must be stopped.
 */
export async function copyKeptState(run: KeptFilesRun): Promise<void> {
  const { root } = run.stateFolder;
  const folder = rollbackFolderOf(root);
  await removePath(folder, run.signal);
  await ensurePrivateFolder(folder, run);
  const files: CopiedFile[] = [];
  for (const name of keptNamesOf(run.stateFolder).flat()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, each checked first
    if (await isThere(join(root, name), run.signal)) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one copy at a time
      await copyFile(join(root, name), join(folder, name), run);
      // oxlint-disable-next-line eslint/no-await-in-loop -- one copy at a time
      files.push({ name, sha256: await fileSha256(join(folder, name), run.signal) });
    }
  }
  await writePrivateFile(copiesListOf(root), `${JSON.stringify({ files })}\n`, run);
}

// The list of copies, when it is there and reads.
async function copiesOf(run: KeptFilesRun): Promise<readonly CopiedFile[] | undefined> {
  const read = await readTextFile(copiesListOf(run.stateFolder.root), run.signal);
  if (!read.ok) {
    return undefined;
  }
  try {
    const parsed = copiesSchema.safeParse(JSON.parse(read.value));
    return parsed.success ? parsed.data.files : undefined;
  } catch {
    return undefined;
  }
}

// Whether every listed copy is still the file the update made.
async function areCopiesWhole(run: KeptFilesRun, files: readonly CopiedFile[]): Promise<boolean> {
  const folder = rollbackFolderOf(run.stateFolder.root);
  const wholeness = files.map(async (file) => {
    const copy = join(folder, file.name);
    return (
      (await isThere(copy, run.signal)) && (await fileSha256(copy, run.signal)) === file.sha256
    );
  });
  return (await Promise.all(wholeness)).every(Boolean);
}

// Puts one group back: the logs go first, so no newer log is ever replayed into an older file,
// then each file the copy holds is copied back, and any other is removed.
async function restoreGroup(
  run: KeptFilesRun,
  names: readonly string[],
  copied: ReadonlySet<string>,
): Promise<void> {
  const { root } = run.stateFolder;
  const folder = rollbackFolderOf(root);
  const [main = "", ...logs] = names;
  for (const name of logs) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, in order
    await removePath(join(root, name), run.signal);
  }
  for (const name of [main, ...logs]) {
    const file = join(root, name);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, in order
    await (copied.has(name)
      ? copyFile(join(folder, name), file, run)
      : removePath(file, run.signal));
  }
}

/**
 * Puts the state the update copied back in place, as plain files, never opened through a
 * database: each database with exactly the log it was copied with, and `config.json5`. Every copy
 * is checked against its SHA-256 before anything changes; a file the update found missing is
 * removed. Answers `missing` when no complete copy is there and `changed` when a copy is not the
 * file the update made, and then changes nothing. The caller holds the engine lock.
 */
export async function restoreKeptState(run: KeptFilesRun): Promise<RestoreOutcome> {
  const files = await copiesOf(run);
  if (files === undefined) {
    return "missing";
  }
  if (!(await areCopiesWhole(run, files))) {
    return "changed";
  }
  const copied = new Set(files.map((file) => file.name));
  for (const names of keptNamesOf(run.stateFolder)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one group at a time
    await restoreGroup(run, names, copied);
  }
  return "restored";
}

/**
 * Removes every tarball an update kept in `updates/` and the copies of `updates/rollback/`; the
 * sealed backup and the update record stay.
 */
export async function removeKeptFiles(run: KeptFilesRun): Promise<void> {
  const folder = updatesFolderOf(run.stateFolder.root);
  await removePath(rollbackFolderOf(run.stateFolder.root), run.signal);
  const tarballs = (await listFolderFiles(folder, run.signal)).filter((name) =>
    tarballName.test(name),
  );
  for (const name of tarballs) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time
    await removePath(join(folder, name), run.signal);
  }
}
