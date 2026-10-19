import type { BlockSource, SeenHead } from "./block-source.js";
import { repeatSteps } from "./repeat-steps.js";

/** What a watcher runs beside its block source, once the signal they share exists. */
export interface HeadsAndSteps {
  /** Hears each new head the block source hands on. */
  readonly onHead: (number: bigint, seen?: SeenHead) => void;
  /** One step of the watcher's reads; the steps repeat until one rejects. */
  readonly step: () => Promise<undefined>;
}

/**
 * Runs a block source and a watcher's steps together until `signal` aborts. `start` gets the
 * signal the two share and answers what hears the heads and what reads. The block source and the
 * reads end together: a fault in either stops both, and the run rejects with it, or with the
 * signal's reason once it aborts.
 */
export async function runWithHeads(
  blocks: BlockSource,
  start: (shared: AbortSignal) => HeadsAndSteps,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const both = new AbortController();
  const stopBoth = (): void => both.abort(signal.reason);
  signal.addEventListener("abort", stopBoth, { once: true });
  const { onHead, step } = start(both.signal);
  const endingBoth = async (work: Promise<void>): Promise<void> => {
    try {
      await work;
    } finally {
      both.abort();
    }
  };
  try {
    await Promise.all([endingBoth(blocks.run(onHead, both.signal)), endingBoth(repeatSteps(step))]);
  } finally {
    signal.removeEventListener("abort", stopBoth);
  }
}
