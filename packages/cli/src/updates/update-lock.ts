import { join } from "node:path";
import {
  acquireFileLock,
  ensurePrivateFolder,
  type FileLock,
  listFolderFiles,
} from "@binference/platform";
import { updatesFolderOf } from "./announced-update.js";
import { type KeptFilesRun, removeKeptFiles } from "./kept-files.js";
import { readUpdateRecord } from "./update-state.js";

/**
 * Takes the update lock, `updates/update.lock`, which one `binference update` holds for its whole
 * run (decision 0356); `undefined` while another holds it. The OS frees it when its process ends,
 * so an update that was killed leaves no lock behind.
 */
export async function holdUpdateLock(run: KeptFilesRun): Promise<FileLock | undefined> {
  const folder = updatesFolderOf(run.stateFolder.root);
  await ensurePrivateFolder(folder, run);
  const lock = acquireFileLock(join(folder, "update.lock"));
  return lock.ok ? lock.value : undefined;
}

/**
 * Removes what an update left behind once its record is final (decision 0356): the database and
 * config copies and the kept tarballs go when no record is there, or it says `updated` or
 * `rolled_back`, so the data on disk is the installed version's. Nothing goes while a record says
 * `checking` or does not read, or while an update runs.
 */
export async function removeLeftovers(run: KeptFilesRun): Promise<void> {
  const record = await readUpdateRecord(run.stateFolder.root, run.signal);
  const isKeptAny = (await listFolderFiles(updatesFolderOf(run.stateFolder.root), run.signal)).some(
    (name) => name.startsWith("rollback/") || name.endsWith(".tgz"),
  );
  if (!isKeptAny || record === "unread" || record?.state === "checking") {
    return;
  }
  const lock = await holdUpdateLock(run);
  if (lock === undefined) {
    return;
  }
  try {
    await removeKeptFiles(run);
  } finally {
    lock.release();
  }
}
