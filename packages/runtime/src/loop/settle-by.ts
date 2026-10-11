import type { Clock } from "@binference/core";

/** How work raced against a signal ended: with its value, with an error, or cut by the signal. */
export type Settled<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error" }
  | { readonly kind: "aborted" };

/** What work is raced against: its signal, and the clock that gives it one tick after an abort. */
export interface SettleOptions {
  readonly signal: AbortSignal;
  readonly clock: Clock;
}

const aborted = { kind: "aborted" } as const;

// The cut comes one clock tick after the abort, so work that answers as it is stopped still counts.
async function cutAfterAbort(options: SettleOptions, finished: AbortSignal): Promise<"cut"> {
  if (!options.signal.aborted) {
    await new Promise<void>((resolve) => {
      options.signal.addEventListener("abort", () => resolve(), { signal: finished });
    });
  }
  await options.clock.sleep(0, finished);
  return "cut";
}

/**
 * Starts work and waits for it only until one clock tick after the signal aborts. Work that
 * ignores its signal is left to settle into nothing, so no tool and no model stream holds the turn
 * past its deadline or its stop. Work that throws, at once or later, settles as an error.
 */
export async function settleBy<T>(
  start: () => Promise<T>,
  options: SettleOptions,
): Promise<Settled<T>> {
  let work: Promise<T>;
  try {
    work = start();
  } catch {
    return { kind: "error" };
  }
  const outcome = work.then(
    (value): Settled<T> => ({ kind: "value", value }),
    (): Settled<T> => ({ kind: "error" }),
  );
  const finished = new AbortController();
  const cut = cutAfterAbort(options, finished.signal).then(
    (): Settled<T> => aborted,
    // The cut is dropped once the work settled; it never decides then.
    (): Promise<Settled<T>> => outcome,
  );
  try {
    return await Promise.race([outcome, cut]);
  } finally {
    finished.abort();
  }
}
