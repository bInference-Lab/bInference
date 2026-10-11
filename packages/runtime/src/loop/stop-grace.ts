import type { Clock } from "@binference/core";

/** A signal that aborts some time after its parent does. */
export interface StopGrace {
  readonly signal: AbortSignal;
  /** Stops waiting; call it when the work ends. */
  clear(): void;
}

/**
 * Gives work that must not be cut at once, a propose call already sent, `graceMs` to finish after
 * the parent aborts (runtime spec, section 4.4). It then aborts with the parent's reason.
 */
export function createStopGrace(parent: AbortSignal, clock: Clock, graceMs: number): StopGrace {
  const controller = new AbortController();
  const finished = new AbortController();
  const expire = async (): Promise<void> => {
    try {
      await clock.sleep(graceMs, finished.signal);
    } catch {
      return;
    }
    controller.abort(parent.reason);
  };
  if (parent.aborted) {
    void expire();
  } else {
    parent.addEventListener("abort", () => void expire(), { signal: finished.signal });
  }
  return { signal: controller.signal, clear: () => finished.abort() };
}
