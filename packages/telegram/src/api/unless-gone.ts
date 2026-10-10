import { isMessageGone } from "./bot-api-error.schema.js";

/**
 * Waits for an edit or a delete of a message. A message Telegram no longer has, or an edit that
 * changes nothing, counts as done; any other fault rejects.
 */
export async function unlessGone<T>(change: Promise<T>): Promise<void> {
  try {
    await change;
  } catch (error) {
    if (!isMessageGone(error)) {
      throw error;
    }
  }
}
