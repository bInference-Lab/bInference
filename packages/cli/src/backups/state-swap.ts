import { join } from "node:path";
import {
  ensurePrivateFolder,
  type FilePermissions,
  listFolderFiles,
  movePath,
  removePath,
  type StateFolder,
} from "@binference/platform";

/** Restored files in place, and how to put the state they replaced back. */
export interface StateSwap {
  /** Where the replaced state waits, kept 7 days; absent when the folder held none. */
  readonly aside?: string;
  /** Puts the replaced state back and the restored files back where they came from. */
  readonly undo: () => Promise<void>;
}

/** The state folder's files a restore replaces, with the database files SQLite keeps beside them. */
const replaced = [
  "engine.sqlite",
  "engine.sqlite-wal",
  "engine.sqlite-shm",
  "agent.sqlite",
  "agent.sqlite-wal",
  "agent.sqlite-shm",
  "config.json5",
  "workspace",
];
/** What a backup restores; every other entry of the state folder, `keys/` first, stays. */
const restored = ["engine.sqlite", "agent.sqlite", "config.json5", "workspace"];
const asideFolder = "replaced";
const keptMs = 7 * 86_400_000;

function stampOf(atMs: number): string {
  return new Date(atMs).toISOString().replaceAll(/[-:]/gu, "").replace("T", "-").slice(0, 15);
}

function atMsOf(stamp: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/u.exec(stamp);
  if (match === null) {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

async function moveEach(
  names: readonly string[],
  places: { readonly from: string; readonly to: string; readonly signal: AbortSignal },
): Promise<readonly string[]> {
  const moved: string[] = [];
  for (const name of names) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one rename at a time, so an undo knows what moved
    const done = await movePath(join(places.from, name), join(places.to, name), places.signal);
    if (done.ok) {
      moved.push(name);
    }
  }
  return moved;
}

/**
 * Puts a restored state in place (keys spec, section 7.4, step 4), with no engine running on the
 * folder: the databases, `config.json5` and `workspace/` it replaces move aside to
 * `replaced/<yyyymmdd-hhmmss>/` in the state folder, kept 7 days, then the restored ones move in,
 * each in one rename. `keys/`, `backups/` and the logs stay. `undo` reverses both moves.
 */
export async function swapInRestored(
  stateFolder: StateFolder,
  from: string,
  options: {
    readonly permissions: FilePermissions;
    readonly atMs: number;
    readonly signal: AbortSignal;
  },
): Promise<StateSwap> {
  const { signal } = options;
  const aside = join(stateFolder.root, asideFolder, stampOf(options.atMs));
  await ensurePrivateFolder(aside, { permissions: options.permissions, signal });
  const root = stateFolder.root;
  const away = await moveEach(replaced, { from: root, to: aside, signal });
  if (away.length === 0) {
    await removePath(aside, signal);
  }
  const placed = await moveEach(restored, { from, to: root, signal });
  return {
    ...(away.length === 0 ? {} : { aside }),
    undo: async () => {
      await moveEach(placed, { from: root, to: from, signal });
      await moveEach(away, { from: aside, to: root, signal });
      await removePath(aside, signal);
    },
  };
}

/**
 * Removes the states restores moved aside once they are 7 days old (keys spec, section 7.4). A
 * folder whose name is no time it wrote stays.
 */
export async function pruneReplaced(
  stateFolder: StateFolder,
  nowMs: number,
  signal: AbortSignal,
): Promise<void> {
  const folder = join(stateFolder.root, asideFolder);
  const files = await listFolderFiles(folder, signal);
  const stamps = new Set(files.map((path) => path.split("/")[0] ?? ""));
  const old = [...stamps].filter((stamp) => {
    const atMs = atMsOf(stamp);
    return atMs !== undefined && nowMs - atMs >= keptMs;
  });
  await Promise.all(old.map(async (stamp) => removePath(join(folder, stamp), signal)));
}
