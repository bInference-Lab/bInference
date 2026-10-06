import { BinferenceError } from "@binference/core";

/**
 * Runs one call of an in-memory store: refuses an aborted signal with its reason, then does the
 * work at once. The work changes nothing until every check in it has passed, so a call that
 * throws leaves the store as it was.
 */
export async function memoryCall<Output>(
  options: { readonly signal: AbortSignal },
  work: () => Output,
): Promise<Output> {
  options.signal.throwIfAborted();
  return await Promise.resolve(work());
}

/** The fault a SQLite constraint gives, raised by an in-memory store for the same write. */
export function constraintFault(what: string): BinferenceError {
  return new BinferenceError({
    code: "store.constraint",
    message: `The in-memory store refused a write: ${what}.`,
  });
}

/** Orders rows as the SQLite store lists them: by creation time, then by id in code-unit order. */
export function byCreation(
  left: { readonly createdAtMs: number; readonly id: string },
  right: { readonly createdAtMs: number; readonly id: string },
): number {
  if (left.createdAtMs !== right.createdAtMs) {
    return left.createdAtMs - right.createdAtMs;
  }
  return left.id < right.id ? -1 : 1;
}
