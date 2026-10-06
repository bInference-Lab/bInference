import { BinferenceError, type Clock, type Random } from "@binference/core";
import type { UpdateIntake } from "../ingress/create-telegram-ingress.js";
import { openPollWorker, type PollWorkerOptions } from "./open-poll-worker.js";
import { pollUpdates } from "./poll-updates.js";
import type { PollerLeases } from "./poller-leases.js";

/** What {@link runPolling} needs. */
export interface RunPollingOptions extends PollWorkerOptions {
  /** The process's leases, so one token has one poller. */
  readonly leases: PollerLeases;
  /** Where each update goes; usually the Telegram ingress. */
  readonly intake: UpdateIntake;
  readonly clock: Clock;
  readonly random: Random;
}

/**
 * Long-polls one bot from a worker thread until the signal aborts or a fault no retry fixes. It
 * takes the token's lease first: a second poller on the same token fails with
 * `telegram.poller_running`. The worker ends and the lease returns however the run ends.
 */
export async function runPolling(
  options: RunPollingOptions,
  call: { readonly signal: AbortSignal },
): Promise<never> {
  const lease = options.leases.acquire(options.token);
  if (!lease.ok) {
    throw new BinferenceError({
      code: "telegram.poller_running",
      message: "This bot token is polled already in this process; stop that poller first.",
      details: { reason: lease.error },
    });
  }
  const worker = openPollWorker(options);
  try {
    return await pollUpdates({ ...options, fetcher: worker, signal: call.signal });
  } finally {
    await worker.close();
    lease.value.release();
  }
}
