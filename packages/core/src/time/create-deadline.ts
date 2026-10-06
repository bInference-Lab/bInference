import { BinferenceError } from "../errors/binference-error.js";
import type { Clock } from "../ports.js";

/** A signal that aborts when its parent aborts or its time runs out. */
export interface Deadline {
  readonly signal: AbortSignal;
  /** Stops the timer and detaches from the parent; call it when the work ends. */
  clear(): void;
}

/** What a {@link Deadline} combines. */
export interface DeadlineOptions {
  readonly clock: Clock;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

interface DeadlineControllers {
  readonly controller: AbortController;
  readonly finished: AbortController;
}

// The sleep rejects once the deadline is cleared or its parent aborts; then nothing is left to do.
async function expireAfter(
  options: DeadlineOptions,
  controllers: DeadlineControllers,
): Promise<void> {
  try {
    await options.clock.sleep(options.timeoutMs, controllers.finished.signal);
  } catch {
    return;
  }
  controllers.controller.abort(
    new BinferenceError({
      code: "core.timeout",
      message: `No answer within ${String(options.timeoutMs)} ms.`,
      retryable: true,
      details: { timeoutMs: options.timeoutMs },
    }),
  );
  controllers.finished.abort();
}

/**
 * Combines a parent signal with a timeout on the clock. On timeout the signal aborts with a
 * retryable `BinferenceError` coded `core.timeout`; on a parent abort, with the parent's reason.
 */
export function createDeadline(options: DeadlineOptions): Deadline {
  const controller = new AbortController();
  const finished = new AbortController();
  const onParentAbort = (): void => {
    controller.abort(options.signal.reason);
    finished.abort();
  };
  if (options.signal.aborted) {
    onParentAbort();
  } else {
    options.signal.addEventListener("abort", onParentAbort, { signal: finished.signal });
    void expireAfter(options, { controller, finished });
  }
  return {
    signal: controller.signal,
    clear: () => {
      finished.abort();
    },
  };
}
