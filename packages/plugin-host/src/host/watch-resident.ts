/** How the resident memory of a plugin's process is watched. */
export interface ResidentWatch {
  /** The process's resident bytes as the OS counts them; `undefined` once it ended. */
  read(pid: number, signal: AbortSignal): Promise<number | undefined>;
  /** Waits between two readings; rejects when the signal aborts. */
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
  /** The most resident bytes the process may hold; the default is {@link residentLimitBytes}. */
  readonly limitBytes?: number;
}

/**
 * The most resident memory a plugin's process may hold (decision 0343): its 256 MiB heap and what
 * Node and its buffers need beside it, which the heap flag does not bound.
 */
const residentLimitBytes = 512 * 1_048_576;
/** How often the resident memory is read. */
const residentCheckMs = 2_000;

/** A process the watch reads and may end. */
export interface WatchedProcess {
  readonly pid?: number | undefined;
  readonly exited: Promise<number | null | undefined>;
  kill(): void;
}

/**
 * Reads a plugin's resident memory every 2 seconds while it runs, and ends it at once past the
 * limit, which the host then counts as its crash (decision 0343). A reading that fails is skipped;
 * the watch stops once the process has ended.
 */
export function watchResident(child: WatchedProcess, watch: ResidentWatch): void {
  const { pid } = child;
  if (pid === undefined) {
    return;
  }
  const stop = new AbortController();
  void child.exited.finally(() => stop.abort());
  const limit = watch.limitBytes ?? residentLimitBytes;
  const next = async (): Promise<void> => {
    await watch.wait(residentCheckMs, stop.signal);
    const bytes = await watch.read(pid, stop.signal);
    if (bytes !== undefined && bytes > limit) {
      child.kill();
      return;
    }
    await next();
  };
  next().catch(() => undefined);
}
