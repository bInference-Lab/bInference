import { BinferenceError, type Logger } from "@binference/core";

/**
 * Hands a push to each place it goes, the protocol server, the owner's bot and the owner's
 * browsers, each on its own: one that throws is logged as `engine.push_failed` and never keeps it
 * from the others, the money path or the turn that pushed it.
 */
export function sendToEach(sends: readonly (() => void)[], logger: Logger): void {
  for (const send of sends) {
    try {
      send();
    } catch (error) {
      const code = error instanceof BinferenceError ? error.code : "unexpected";
      logger.warn("engine.push_failed", { errorCode: code });
    }
  }
}
