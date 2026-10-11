import type { ProtocolClient } from "@binference/client";
import type { Clock } from "@binference/core";
import {
  type JobDonePush,
  jobDonePushSchema,
  type JobFailedPush,
  jobFailedPushSchema,
  type ProtocolId,
  type PushFrame,
} from "@binference/protocol";

/** How a long job ended, as its push on the `job` topic says. */
export type JobEnd =
  | { readonly kind: "done"; readonly push: JobDonePush }
  | { readonly kind: "failed"; readonly push: JobFailedPush };

/** The ends of the jobs the `job` topic reports from the moment it is watched. */
export interface JobEnds {
  /**
   * The end of one job. Rejects with the client's error once the client closes, as when the
   * engine stops, and with the signal's reason when it aborts first.
   */
  of(job: ProtocolId<"longJob">, signal: AbortSignal): Promise<JobEnd>;
  /** Ends the watch. */
  close(): void;
}

// How often a wait looks whether the client closed.
const lookMs = 1_000;

function endOf(push: PushFrame): JobEnd | undefined {
  if (push.kind === "job/done") {
    const done = jobDonePushSchema.safeParse(push.data);
    return done.success ? { kind: "done", push: done.data } : undefined;
  }
  if (push.kind === "job/failed") {
    const failed = jobFailedPushSchema.safeParse(push.data);
    return failed.success ? { kind: "failed", push: failed.data } : undefined;
  }
  return undefined;
}

// Rejects once the client closes or the signal aborts; never resolves.
async function untilClosed(
  client: ProtocolClient,
  clock: Clock,
  signal: AbortSignal,
): Promise<never> {
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one look a second until the client closes
    await clock.sleep(lookMs, signal);
    const status = client.status();
    if (status.state === "closed") {
      throw status.error;
    }
  }
}

/**
 * Watches the `job` topic for the ends of long jobs (protocol spec, section 7). Start it before
 * the call that starts a job, so its end is never missed. The topic has no list to refetch: a
 * job's end the engine no longer holds is never seen, and the wait ends with its signal.
 */
export function watchJobEnds(client: ProtocolClient, clock: Clock): JobEnds {
  const ended = new Map<string, JobEnd>();
  const waiting = new Map<string, (end: JobEnd) => void>();
  const unsubscribe = client.subscribe("job", {
    onPush: (push) => {
      const end = endOf(push);
      if (end !== undefined) {
        const waiter = waiting.get(end.push.job);
        if (waiter === undefined) {
          ended.set(end.push.job, end);
        } else {
          waiter(end);
        }
      }
    },
    refetch: async () => Promise.resolve(),
  });
  return {
    async of(job, signal) {
      const looking = new AbortController();
      const arrived = new Promise<JobEnd>((resolve) => {
        const known = ended.get(job);
        if (known === undefined) {
          waiting.set(job, resolve);
        } else {
          resolve(known);
        }
      });
      try {
        return await Promise.race([
          arrived,
          untilClosed(client, clock, AbortSignal.any([signal, looking.signal])),
        ]);
      } finally {
        looking.abort();
        waiting.delete(job);
      }
    },
    close: unsubscribe,
  };
}
