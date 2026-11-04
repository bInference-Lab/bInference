import { type Clock, createIdSource, type Random } from "@binference/core";
import type { ProtocolId } from "@binference/protocol";
import type { Closers } from "./closers.js";

/** A long job that runs one at a time, such as an install. */
export interface SingleJob {
  /**
   * Starts `work` as a new job and answers its id, or, while one runs, answers that one's id and
   * starts nothing. `work` gets the signal the engine's stop aborts.
   */
  start(
    work: (job: ProtocolId<"longJob">, stop: AbortSignal) => Promise<void>,
  ): ProtocolId<"longJob">;
}

/**
 * Runs long jobs one at a time (protocol spec, section 7): a call while one runs gets that job's
 * id. The engine's stop aborts the job under way and waits for it, through the closer `name`.
 */
export function createSingleJob(parts: {
  readonly clock: Clock;
  readonly random: Random;
  readonly closers: Closers;
  readonly name: string;
}): SingleJob {
  const ids = createIdSource({ clock: parts.clock, random: parts.random });
  const stop = new AbortController();
  const running: { job: ProtocolId<"longJob"> | undefined; ended: Promise<void> } = {
    job: undefined,
    ended: Promise.resolve(),
  };
  parts.closers.add(parts.name, async () => {
    stop.abort();
    await running.ended;
  });
  return {
    start(work) {
      if (running.job !== undefined) {
        return running.job;
      }
      const job = ids.next("job");
      running.job = job;
      running.ended = work(job, stop.signal).finally(() => {
        running.job = undefined;
      });
      return job;
    },
  };
}
