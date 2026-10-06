import { BinferenceError, type Logger } from "@binference/core";

/**
 * Runs work in the background and logs its failure under an event, with the error code when the
 * failure is a `BinferenceError`; it never rejects. For work whose next chance comes on its own,
 * such as a subscribe that runs again on the next connection.
 */
export async function logFailure(
  logger: Logger,
  event: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.warn(event, { errorCode: error instanceof BinferenceError ? error.code : "unexpected" });
  }
}
