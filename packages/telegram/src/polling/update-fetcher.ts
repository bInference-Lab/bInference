import { BinferenceError } from "@binference/core";
import type { Api } from "grammy";
import { assertGrammySignal } from "../api/assert-grammy-signal.js";
import { botApiFault } from "../api/bot-api-error.schema.js";
import { type PolledUpdate, polledBatchOf } from "./poll-messages.schema.js";

/** The most updates one `getUpdates` call returns. */
const pollLimit = 100;
/** How long Telegram holds one `getUpdates` call open while no update comes. */
const pollTimeoutSeconds = 30;
/** The longest one `getUpdates` call may take, long poll included. */
export const fetchTimeoutMs: number = (pollTimeoutSeconds + 30) * 1000;
// Groups stay off, so group-only kinds are never asked for.
const allowedUpdates = ["message", "edited_message", "callback_query"] as const;

/** Fetches the next updates from the Bot API. */
export interface UpdateFetcher {
  /**
   * The updates from `offset` on, or every unacknowledged one without it. Asking from an offset
   * acknowledges every update before it, so Telegram drops those. Faults are `BinferenceError`s
   * with the codes of `botApiFault`.
   */
  fetch(
    offset: number | undefined,
    options: { readonly signal: AbortSignal },
  ): Promise<readonly PolledUpdate[]>;
}

/** Fetches updates with grammY's `Api`, in this thread: the poll worker's own fetcher. */
export function createApiFetcher(api: Api): UpdateFetcher {
  return {
    fetch: async (offset, options) => {
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(fetchTimeoutMs)]);
      try {
        const answer = await api.getUpdates(
          {
            ...(offset === undefined ? {} : { offset }),
            limit: pollLimit,
            timeout: pollTimeoutSeconds,
            allowed_updates: allowedUpdates,
          },
          assertGrammySignal(signal),
        );
        return polledBatchOf(answer);
      } catch (error) {
        options.signal.throwIfAborted();
        throw error instanceof BinferenceError ? error : botApiFault(error, "getUpdates");
      }
    },
  };
}
