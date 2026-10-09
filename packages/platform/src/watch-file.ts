import { type FSWatcher, realpathSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { BinferenceError } from "@binference/core";

/** A watch on one file, until it is closed. */
export interface FileWatch {
  /** Stops watching; safe to call more than once. */
  close(): void;
}

/** What hears a watched file change. */
export interface WatchFileOptions {
  /** Called on each change to the file: a write, a rename over it, its removal or its return. */
  readonly onChange: () => void;
  /** Called once if the folder's watch stops by itself, such as when the folder is removed. */
  readonly onError: (error: BinferenceError) => void;
}

function watchFailed(path: string, cause: Error | undefined): BinferenceError {
  return new BinferenceError({
    code: "platform.watch_failed",
    message: `Could not watch ${path}.`,
    cause,
    details: { path },
  });
}

/** The watch on the file itself, armed again on the new file once one replaces it. */
interface FileWatcher {
  /** Watches what the path names now; a missing file waits for the folder to see it back. */
  arm(): void;
  isArmed(): boolean;
  close(): void;
}

// The file's own watch is live as soon as it returns; a rename ends it on the old file, so it is
// armed again on whatever the path names now.
function createFileWatcher(path: string, onChange: () => void): FileWatcher {
  const state: { current: FSWatcher | undefined; isClosed: boolean } = {
    current: undefined,
    isClosed: false,
  };
  const arm = (): void => {
    state.current?.close();
    state.current = undefined;
    if (state.isClosed) {
      return;
    }
    try {
      const watcher = watch(path, { persistent: false }, (event) => {
        if (event === "rename") {
          arm();
        }
        onChange();
      });
      // A file watch that fails ends; the folder's watch arms it again at the next change.
      watcher.on("error", () => {
        watcher.close();
        if (state.current === watcher) {
          state.current = undefined;
        }
      });
      state.current = watcher;
    } catch {
      state.current = undefined;
    }
  };
  return {
    arm,
    isArmed: () => state.current !== undefined,
    close: () => {
      state.isClosed = true;
      state.current?.close();
    },
  };
}

function watchFolder(path: string, onFileEvent: () => void): FSWatcher {
  const name = basename(path);
  try {
    // macOS names a folder's events by its real path, so a folder reached through a link, such
    // as the temporary folder, is watched where it is.
    return watch(realpathSync(dirname(path)), { persistent: false }, (_event, changed) => {
      if (changed === null || changed === name) {
        onFileEvent();
      }
    });
  } catch (error) {
    throw watchFailed(path, error instanceof Error ? error : undefined);
  }
}

/**
 * Watches a file through its folder and the file itself: the folder's watch hears an editor that
 * saves by renaming a new file over the old one, and a file that comes back; the file's own watch
 * is live the moment this returns, where some OSes start a folder's watch a moment later. One save
 * fires several changes, and an event that names no file counts as the file's; the caller waits
 * for the changes to settle. The watch does not keep the process alive. Throws
 * `platform.watch_failed` when the folder cannot be watched.
 */
export function watchFile(path: string, options: WatchFileOptions): FileWatch {
  const file = createFileWatcher(path, options.onChange);
  const folder = watchFolder(path, () => {
    if (!file.isArmed()) {
      file.arm();
    }
    options.onChange();
  });
  folder.on("error", (error) => {
    folder.close();
    options.onError(watchFailed(path, error));
  });
  file.arm();
  return {
    close: () => {
      file.close();
      folder.close();
    },
  };
}
