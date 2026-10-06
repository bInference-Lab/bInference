import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import type { IntentChange } from "@binference/engine";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { orNull } from "../rows/column-values.js";

function closeCard(database: DatabaseSync, change: IntentChange): void {
  const closing = change.closeCard;
  if (closing === undefined) {
    return;
  }
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const closed = execute(
    kysely
      .updateTable("cards")
      .set({ closed_at: change.atMs, close_reason: closing.reason })
      .where("id", "=", closing.id)
      .where("intent_id", "=", change.id)
      .where("closed_at", "is", null),
  );
  if (closed.numAffectedRows !== 1n) {
    throw new BinferenceError({
      code: "store.card_not_open",
      message: `Card ${closing.id} is not an open card of intent ${change.id}.`,
      details: { intent: change.id, card: closing.id },
    });
  }
}

/**
 * Writes the card and confirmation parts of a move inside its transaction: closes the open card
 * version it names, opens the new one, and records the confirmation. A card that is not open
 * throws `store.card_not_open`; a taken card version or a second confirmation fails SQLite's
 * constraints. Either rolls the whole move back.
 */
export function writeCardChanges(database: DatabaseSync, change: IntentChange): void {
  closeCard(database, change);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const { openCard, confirmation } = change;
  if (openCard !== undefined) {
    execute(
      kysely.insertInto("cards").values({
        id: openCard.id,
        intent_id: change.id,
        version: openCard.version,
        terms_hash: openCard.termsHash,
        callback_ref: orNull(openCard.callbackRef),
        opened_at: openCard.openedAtMs,
        expires_at: openCard.expiresAtMs,
        closed_at: null,
        close_reason: null,
      }),
    );
  }
  if (confirmation !== undefined) {
    execute(
      kysely.insertInto("confirmations").values({
        id: confirmation.id,
        intent_id: change.id,
        card_id: confirmation.cardId,
        card_version: confirmation.cardVersion,
        terms_hash: confirmation.termsHash,
        by_surface: confirmation.bySurface,
        by_ref: confirmation.byRef,
        at: change.atMs,
        expires_at: confirmation.expiresAtMs,
      }),
    );
  }
}
