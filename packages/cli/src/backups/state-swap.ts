import { join } from "node:path";
import { BinferenceError } from "@binference/core";
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
  /**
   * Puts the replaced state back and the restored files back where they came from, in the reverse
   * order of the moves. Every move is tried; when one fails, `backup.restore_rollback_failed` is
   * thrown once all were tried, and neither folder is removed.
   */
  readonly undo: () => Promise<void>;
}

/** Moves one path to another in one rename, as `movePath` does; tests put faults here. */
export type MovePath = typeof movePath;

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
/**
 * What a backup restores; every other entry of the state folder, `keys/` first, stays. The checks
 * before the swap open the restored databases, so their log files move with them when present.
 */
const restored = replaced;
const asideFolder = "replaced";
const keptMs = 7 * 86_400_000;

function stampOf(atMs: number): string {
  return new Date(atMs).toISOString().replaceAll(/[-:]/gu, "").replace("T", "-").slice(0, 15);
}

// A stamp, with the count a later restore of the same second adds after it.
function atMsOf(stamp: string): number | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/u.exec(stamp);
  if (match === null) {
    return undefined;
  }
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0);
}

/** One rename that happened, so it can be reversed. */
interface Moved {
  readonly from: string;
  readonly to: string;
}

/** The renames of one swap, in the order they happened. */
interface Journal {
  readonly moves: Moved[];
  readonly move: MovePath;
  readonly signal: AbortSignal;
}

async function moveEach(
  journal: Journal,
  names: readonly string[],
  places: { readonly from: string; readonly to: string },
): Promise<number> {
  let count = 0;
  for (const name of names) {
    const from = join(places.from, name);
    const to = join(places.to, name);
    // oxlint-disable-next-line eslint/no-await-in-loop -- one rename at a time, so an undo knows what moved
    const done = await journal.move(from, to, journal.signal);
    if (done.ok) {
      journal.moves.push({ from, to });
      count += 1;
    }
  }
  return count;
}

/**
 * The fault of a swap that could not be reversed in full: the state folder mixes the two states.
 * Its details name where the replaced state waits and where the restored files were staged, so
 * the owner can finish by hand; neither folder is removed.
 */
function rollbackFailed(
  places: { readonly aside: string; readonly staged: string },
  cause: Error,
): BinferenceError {
  return new BinferenceError({
    code: "backup.restore_rollback_failed",
    message: `A restore could not put the replaced state back; it waits in ${places.aside}.`,
    cause,
    details: { aside: places.aside, staged: places.staged },
  });
}

// Reverses every rename, newest first. Each is tried even when one before it failed, so as much
// as can go back does, but a path a failed move back still holds is never moved onto: a rename
// would replace what is there on some systems. A fault is thrown once all were tried. An undo is
// never aborted.
async function reverse(journal: Journal): Promise<void> {
  const faults: Error[] = [];
  const left: Moved[] = [];
  const held = new Set<string>();
  const signal = new AbortController().signal;
  for (const moved of journal.moves.toReversed()) {
    try {
      if (held.has(moved.from)) {
        throw new BinferenceError({
          code: "backup.restore_path_held",
          message: `${moved.from} still holds a file that could not move back.`,
        });
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- the reverse order of the moves
      await journal.move(moved.to, moved.from, signal);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      faults.push(error);
      left.unshift(moved);
      held.add(moved.to);
    }
  }
  journal.moves.splice(0, journal.moves.length, ...left);
  const [first] = faults;
  if (first !== undefined) {
    throw first;
  }
}

// The folder the replaced state waits in: named by the restore's second, with a count after it
// when a restore of the same second already set a state aside there, so none replaces another.
async function asideOf(stateFolder: StateFolder, atMs: number, signal: AbortSignal) {
  const folder = join(stateFolder.root, asideFolder);
  const taken = new Set(
    (await listFolderFiles(folder, signal)).map((path) => path.split("/")[0] ?? ""),
  );
  const stamp = stampOf(atMs);
  const free = (count: number): string => {
    const name = count === 1 ? stamp : `${stamp}-${String(count)}`;
    return taken.has(name) ? free(count + 1) : name;
  };
  return join(folder, free(1));
}

/**
 * Puts a restored state in place (keys spec, section 7.4, step 4), with no engine running on the
 * folder: the databases, `config.json5` and `workspace/` it replaces move aside to
 * `replaced/<yyyymmdd-hhmmss>/` in the state folder (`-2` after it for a second restore of that
 * second), kept 7 days, then the restored ones move in,
 * each in one rename. `keys/`, `backups/` and the logs stay. The swap is all or nothing: when a
 * rename fails, every rename made so far is reversed, newest first, and the fault is thrown, so
 * the state folder is as it was and the restored files are back where they came from; a reversal
 * that fails too throws `backup.restore_rollback_failed`. `undo` reverses a swap that finished.
 */
export async function swapInRestored(
  stateFolder: StateFolder,
  from: string,
  options: {
    readonly permissions: FilePermissions;
    readonly atMs: number;
    readonly signal: AbortSignal;
    readonly move?: MovePath;
  },
): Promise<StateSwap> {
  const { signal } = options;
  const aside = await asideOf(stateFolder, options.atMs, signal);
  await ensurePrivateFolder(aside, { permissions: options.permissions, signal });
  const root = stateFolder.root;
  const journal: Journal = { moves: [], move: options.move ?? movePath, signal };
  const places = { aside, staged: from };
  // Puts everything back, then removes the empty folder the replaced state waited in.
  const putBack = async (): Promise<void> => {
    try {
      await reverse(journal);
    } catch (error) {
      throw error instanceof Error ? rollbackFailed(places, error) : error;
    }
    await removePath(aside, new AbortController().signal);
  };
  let away = 0;
  try {
    away = await moveEach(journal, replaced, { from: root, to: aside });
    await moveEach(journal, restored, { from, to: root });
  } catch (error) {
    await putBack();
    throw error;
  }
  if (away === 0) {
    await removePath(aside, signal);
  }
  return { ...(away === 0 ? {} : { aside }), undo: putBack };
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
