import { BinferenceError } from "@binference/core";
import type { Shutdown, ShutdownStep } from "@binference/platform";

/**
 * What closes each part the engine opened, in the order the parts opened. A part opened later
 * may use one opened earlier, so parts close in the reverse order.
 */
export interface Closers {
  /** Adds what closes a part, as soon as it opens. Throws `cli.too_many_parts` past 32. */
  add(name: string, close: ShutdownStep): void;
  /** Closes every part opened so far, last first, when the start fails part way; never throws. */
  closeAll(signal: AbortSignal): Promise<void>;
  /** Hands every closer to the shutdown sequence as its steps, last opened first. */
  handTo(shutdown: Shutdown): void;
}

interface Closer {
  readonly name: string;
  readonly close: ShutdownStep;
}

const maxClosers = 32;

/** Creates an empty list of closers. */
export function createClosers(): Closers {
  const opened: Closer[] = [];
  return {
    add(name, close) {
      if (opened.length >= maxClosers) {
        throw new BinferenceError({
          code: "cli.too_many_parts",
          message: `The engine closes at most ${String(maxClosers)} parts.`,
          details: { name },
        });
      }
      opened.push({ name, close });
    },
    async closeAll(signal) {
      // One at a time, last first; a part that fails to close leaves the rest to close.
      await opened
        .splice(0)
        .toReversed()
        .reduce<Promise<void>>(
          async (earlier, closer) =>
            earlier.then(async () => closer.close(signal).catch(() => undefined)),
          Promise.resolve(),
        );
    },
    handTo(shutdown) {
      opened
        .splice(0)
        .toReversed()
        .forEach((closer) => shutdown.add(closer.name, closer.close));
    },
  };
}
