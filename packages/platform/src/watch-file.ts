import {
  type FSWatcher,
  realpathSync,
  type StatsListener,
  unwatchFile,
  watch,
  watchFile as pollFile,
} from "node:fs";
import { basename, dirname } from "node:path";
import { BinferenceError, type Clock } from "@binference/core";

/** A watch on one file, until it is closed. */
export interface FileWatch {
  /** Stops watching; safe to call more than once. */
  close(): void;
}

/** What hears a watched file change. */
export interface WatchFileOptions {
  /** Called on each change to the file: a write, a rename over it, its removal or its return. */
  readonly onChange: () => void;
  /** Called once if the watch stops for good: the timer could not check the file either. */
  readonly onError: (error: BinferenceError) => void;
  /**
   * Called when the OS's file events failed: `retrying` while the watch is made again after a
   * wait, `poll` once it checks the file on a timer instead (decision 0396).
   */
  readonly onDegraded?: (state: "retrying" | "poll", error: BinferenceError) => void;
  /** Times the waits between attempts. */
  readonly clock: Clock;
  /** The OS's watch, which a test replaces to make it fail. */
  readonly nativeWatch?: typeof watch;
}

/** The waits before each new attempt at the OS's file events, then the timer takes over. */
const retryDelaysMs: readonly number[] = [500, 2_000, 5_000];
/** How often the timer checks the file once the OS's file events failed. */
const pollIntervalMs = 100;

function watchFailed(path: string, cause: Error | undefined): BinferenceError {
  return new BinferenceError({
    code: "platform.watch_failed",
    message: `Could not watch ${path}.`,
    cause,
    details: { path },
  });
}

/** The OS's watch of the file and its folder, closed as one. */
interface EventWatch {
  close(): void;
}

// The file's own watch is live as soon as it returns; a rename ends it on the old file, so it is
// armed again on whatever the path names now. A file watch that fails ends; the folder's arms it
// again at the next change.
function createFileWatcher(path: string, native: typeof watch, onChange: () => void) {
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
      const watcher = native(path, { persistent: false }, (event) => {
        if (event === "rename") {
          arm();
        }
        onChange();
      });
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
  const close = (): void => {
    state.isClosed = true;
    state.current?.close();
  };
  return { arm, isArmed: () => state.current !== undefined, close };
}

// Watches the file through its folder and itself; `onFailed` hears the folder's watch fail.
function watchEvents(
  path: string,
  options: WatchFileOptions,
  onFailed: (error: BinferenceError) => void,
): EventWatch {
  const native = options.nativeWatch ?? watch;
  const file = createFileWatcher(path, native, options.onChange);
  const name = basename(path);
  // macOS names a folder's events by its real path, so a folder reached through a link, such as
  // the temporary folder, is watched where it is.
  const folder = native(realpathSync(dirname(path)), { persistent: false }, (_event, changed) => {
    if (changed === null || changed === name) {
      if (!file.isArmed()) {
        file.arm();
      }
      options.onChange();
    }
  });
  folder.on("error", (error) => {
    folder.close();
    file.close();
    onFailed(watchFailed(path, error));
  });
  file.arm();
  return {
    close: () => {
      file.close();
      folder.close();
    },
  };
}

// Checks the file on a timer: a change of its size, time or node is a change, a rename over it
// too, since the path is checked each time.
function watchByPolling(path: string, onChange: () => void): EventWatch {
  const listener: StatsListener = (now, before) => {
    if (now.mtimeMs !== before.mtimeMs || now.size !== before.size || now.ino !== before.ino) {
      onChange();
    }
  };
  pollFile(path, { persistent: false, interval: pollIntervalMs }, listener);
  return { close: () => unwatchFile(path, listener) };
}

function isMissingFolder(cause: Error | undefined): boolean {
  return cause !== undefined && "code" in cause && cause.code === "ENOENT";
}

// Waits, then makes the watch again; a watch closed meanwhile is left closed.
async function startAfter(
  clock: Clock,
  wait: { readonly delayMs: number; readonly signal: AbortSignal },
  start: () => void,
): Promise<void> {
  try {
    await clock.sleep(wait.delayMs, wait.signal);
  } catch {
    return;
  }
  start();
}

/**
 * Watches a file through its folder and the file itself: the folder's watch hears an editor that
 * saves by renaming a new file over the old one, and a file that comes back; the file's own watch
 * is live the moment this returns, where some OSes start a folder's watch a moment later. One save
 * fires several changes, and an event that names no file counts as the file's; the caller waits
 * for the changes to settle. When the OS's file events fail, as when the machine runs out of file
 * watches, the file is read again at once, the watch is made again after 0.5, 2 and 5 seconds,
 * and then the file is checked every 100 milliseconds instead (decision 0396). The watch does not
 * keep the process alive. Throws `platform.watch_failed` when the folder does not exist.
 */
export function watchFile(path: string, options: WatchFileOptions): FileWatch {
  const { clock } = options;
  const stop = new AbortController();
  const state: { current: EventWatch | undefined; attempt: number } = {
    current: undefined,
    attempt: 0,
  };
  const degrade = (failed: BinferenceError): void => {
    state.current = undefined;
    options.onChange();
    const delayMs = retryDelaysMs[state.attempt];
    if (delayMs !== undefined) {
      state.attempt += 1;
      options.onDegraded?.("retrying", failed);
      void startAfter(clock, { delayMs, signal: stop.signal }, start);
      return;
    }
    options.onDegraded?.("poll", failed);
    try {
      state.current = watchByPolling(path, options.onChange);
    } catch (failure) {
      options.onError(watchFailed(path, failure instanceof Error ? failure : undefined));
    }
  };
  const start = (): void => {
    if (stop.signal.aborted) {
      return;
    }
    try {
      state.current = watchEvents(path, options, degrade);
    } catch (error) {
      degrade(watchFailed(path, error instanceof Error ? error : undefined));
    }
  };
  try {
    state.current = watchEvents(path, options, degrade);
  } catch (error) {
    const cause = error instanceof Error ? error : undefined;
    if (isMissingFolder(cause)) {
      throw watchFailed(path, cause);
    }
    degrade(watchFailed(path, cause));
  }
  return {
    close: () => {
      stop.abort();
      state.current?.close();
    },
  };
}
