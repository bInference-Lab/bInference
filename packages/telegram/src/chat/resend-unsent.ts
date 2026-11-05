import type { Clock } from "@binference/core";
import { isUnsentRequest } from "../api/bot-api-error.schema.js";

/** The most tries of one message of an answer, the first among them. */
const maxAttempts = 3;
// The wait before the second try; each later one doubles it, up to 30 seconds.
const firstWaitMs = 400;
const maxWaitMs = 30_000;

/**
 * Runs one send of an answer's message and runs it again, up to 3 tries in all, after 400 ms and
 * then 800 ms, only while it provably never left: no connection to Telegram opened. Any other
 * failure, and the last one, goes to the caller, since a message that may have landed must never
 * show twice. An abort ends the wait.
 */
export async function resendUnsent<T>(
  send: () => Promise<T>,
  at: { readonly clock: Clock; readonly signal: AbortSignal },
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each try follows the one before
      return await send();
    } catch (error) {
      if (attempt >= maxAttempts || !isUnsentRequest(error)) {
        throw error;
      }
      const waitMs = Math.min(maxWaitMs, firstWaitMs * 2 ** (attempt - 1));
      // oxlint-disable-next-line eslint/no-await-in-loop -- the next try waits for its time
      await at.clock.sleep(waitMs, at.signal);
    }
  }
}
