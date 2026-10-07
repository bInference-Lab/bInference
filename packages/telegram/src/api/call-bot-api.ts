import { assertGrammySignal, type GrammySignal } from "./assert-grammy-signal.js";
import { botApiFault } from "./bot-api-error.schema.js";

/**
 * Makes one Bot API call through grammY and maps its failure with {@link botApiFault}. The signal
 * only says when to stop: the bot's throttler bounds each attempt and owns every 429 wait, so a
 * caller adds no deadline of its own. Once the signal aborts, the call rejects with its reason.
 */
export async function callBotApi<T>(
  method: string,
  signal: AbortSignal,
  run: (signal: GrammySignal) => Promise<T>,
): Promise<T> {
  try {
    return await run(assertGrammySignal(signal));
  } catch (error) {
    signal.throwIfAborted();
    throw botApiFault(error, method);
  }
}
