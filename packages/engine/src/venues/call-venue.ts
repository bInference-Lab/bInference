import { type Clock, createDeadline, err, ok, type Result } from "@binference/core";
import type { z } from "zod";

/** What one call into a venue runs under. */
export interface VenueCallOptions {
  readonly clock: Clock;
  /** The caller's signal: its abort stops the work rather than failing the venue. */
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

// Settles only by rejecting, once the signal aborts, so a venue that ignores its signal still
// loses the race.
async function whenStopped(signal: AbortSignal): Promise<never> {
  return await new Promise<never>((_resolve, reject) => {
    const stop = (): void => {
      reject(new Error("The venue call was stopped."));
    };
    if (signal.aborted) {
      stop();
      return;
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Runs one call into venue code under the host's timeout. A throw, a timeout, or a venue that
 * never answers is `venue_down`. An abort of the caller's own signal rejects with its reason: the
 * intent stops, and the venue is not to blame.
 */
export async function callVenue<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: VenueCallOptions,
): Promise<Result<T, "venue_down">> {
  const deadline = createDeadline(options);
  try {
    return ok(await Promise.race([work(deadline.signal), whenStopped(deadline.signal)]));
  } catch {
    options.signal.throwIfAborted();
    return err("venue_down");
  } finally {
    deadline.clear();
  }
}

/**
 * Checks a value a venue returned against its schema and gives the host its own copy, so the
 * venue cannot change what the host checked. A value that breaks the schema is undefined.
 */
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- zod schemas are mutable
export function ownCopy<T, W>(schema: z.ZodType<T, W>, value: T): T | undefined {
  const wire = schema.safeEncode(value);
  const copy = wire.success ? schema.safeDecode(wire.data) : undefined;
  return copy?.success === true ? copy.data : undefined;
}
