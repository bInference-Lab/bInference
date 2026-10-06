import {
  BinferenceError,
  type Clock,
  type Random,
  retry,
  type RetryPolicy,
} from "@binference/core";
import type { UpdateIntake } from "../ingress/create-telegram-ingress.js";
import type { PolledUpdate } from "./poll-messages.schema.js";
import type { UpdateFetcher } from "./update-fetcher.js";

/** What {@link pollUpdates} needs. */
export interface PollOptions {
  readonly fetcher: UpdateFetcher;
  readonly intake: UpdateIntake;
  readonly clock: Clock;
  readonly random: Random;
  /** Stops polling; the run then rejects with the signal's reason. */
  readonly signal: AbortSignal;
}

// A poller outlives any outage: it keeps trying, at most 30 seconds apart.
const backoff: RetryPolicy = {
  attempts: Number.POSITIVE_INFINITY,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  budgetMs: Number.POSITIVE_INFINITY,
};

function floodWaitMs(error: Error): number | undefined {
  if (!(error instanceof BinferenceError) || error.code !== "telegram.flood") {
    return undefined;
  }
  const waitMs = error.details["retryAfterMs"];
  return typeof waitMs === "number" ? waitMs : undefined;
}

async function nextBatch(
  offset: number | undefined,
  options: PollOptions,
): Promise<readonly PolledUpdate[]> {
  return retry(
    async ({ signal }) => {
      try {
        return await options.fetcher.fetch(offset, { signal });
      } catch (error) {
        const waitMs = error instanceof Error ? floodWaitMs(error) : undefined;
        if (waitMs !== undefined) {
          await options.clock.sleep(waitMs, signal);
        }
        throw error;
      }
    },
    { ...backoff, clock: options.clock, random: options.random, signal: options.signal },
  );
}

// Each update is stored before the next offset is taken, so none is acknowledged unstored.
async function receiveInOrder(
  batch: readonly PolledUpdate[],
  offset: number | undefined,
  options: PollOptions,
): Promise<number | undefined> {
  return batch.reduce<Promise<number | undefined>>(async (previous, polled) => {
    const before = await previous;
    await options.intake.receive(polled.update, { signal: options.signal });
    return Math.max(before ?? 0, polled.updateId + 1);
  }, Promise.resolve(offset));
}

/**
 * Long-polls the Bot API until the signal aborts or a fault that no retry fixes, such as
 * `telegram.bad_token` or `telegram.poll_conflict`. Each update goes to the intake, and the
 * offset that acknowledges it is sent only after the intake has stored it: a crash in between
 * brings the update again, and the intake stores it once. Network faults back off with jitter;
 * a flood wait waits as long as Telegram asks.
 */
export async function pollUpdates(options: PollOptions): Promise<never> {
  let offset: number | undefined;
  for (;;) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the next getUpdates acknowledges this batch, so batches run one at a time
    offset = await receiveInOrder(await nextBatch(offset, options), offset, options);
  }
}
