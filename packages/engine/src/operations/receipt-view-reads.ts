import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { CardShowings } from "../surfaces/create-card-showings.js";
import { settlingReceiptOf } from "../surfaces/settling-receipt.js";
import type { ViewReads } from "./intent-view-of.js";

/** What an intent's receipt is read from: the card showings every button surface reads. */
export interface ReceiptViewOptions {
  readonly showings: Pick<CardShowings, "settled">;
}

/**
 * The line an intent's closed card ends with (decision 0346), drawn as Telegram's copies of it
 * are: how it closed and what followed. Nothing for an intent whose card never closed, or one
 * the engine draws no receipt for, such as a paper intent still filling.
 */
export async function receiptViewReads(
  options: ReceiptViewOptions,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<Pick<ViewReads, "receipt">> {
  if (!snapshot.history.cards.some((card) => card.closeReason !== undefined)) {
    return {};
  }
  const settling = await options.showings.settled(snapshot.record.id, { signal });
  return settling === undefined ? {} : { receipt: settlingReceiptOf(settling) };
}
