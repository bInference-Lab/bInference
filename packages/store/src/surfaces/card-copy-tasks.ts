import type { DatabaseSync } from "node:sqlite";
import { BinferenceError, type Id, idSchema } from "@binference/core";
import { type CardCopy, cardCopySchema } from "@binference/engine/surfaces";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

// Copies the owner's bot posted; the console and the Mini App keep none here.
const surface = "telegram";
const wholeNumber = /^-?\d+$/;

// A copy as the join of `card_messages` and its card version reads, with its ids as text.
const copyRowSchema = z
  .object({
    callback_ref: z.string(),
    intent_id: z.string(),
    version: z.int(),
    chat_id: z.string().regex(wholeNumber),
    message_id: z.string().regex(wholeNumber),
    sent_at: z.int(),
  })
  .transform((row) =>
    cardCopySchema.parse({
      ref: row.callback_ref,
      intent: row.intent_id,
      cardVersion: row.version,
      chatId: Number(row.chat_id),
      messageId: Number(row.message_id),
      sentAtMs: row.sent_at,
    }),
  );

// Every Telegram copy with its card version, read through one join.
function copiesQuery(database: DatabaseSync) {
  const sync = createSyncKysely<EngineTables>(database);
  const query = sync.kysely
    .selectFrom("card_messages")
    .innerJoin("cards", "cards.id", "card_messages.card_id")
    .select([
      "cards.callback_ref",
      "cards.intent_id",
      "cards.version",
      "card_messages.chat_id",
      "card_messages.message_id",
      "card_messages.sent_at",
    ])
    .where("card_messages.surface", "=", surface);
  return { sync, query };
}

/**
 * Keeps one Telegram copy under the card version its callback reference names; the same message
 * again changes nothing. A reference no stored card version holds, or one of another intent or
 * version, fails with `store.unknown_card`.
 */
export const keepCardCopyTask: StoreTask<CardCopy, null> = defineTask({
  name: "telegram.keep_card_copy",
  access: "write",
  input: cardCopySchema,
  output: z.null(),
  run(database, copy) {
    const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
    const card = takeFirst(
      kysely
        .selectFrom("cards")
        .select(["id", "intent_id", "version"])
        .where("callback_ref", "=", copy.ref),
    );
    if (card?.intent_id !== copy.intent || card.version !== copy.cardVersion) {
      throw new BinferenceError({
        code: "store.unknown_card",
        message: "No stored card version holds this copy's callback reference.",
        details: { intentId: copy.intent },
      });
    }
    execute(
      kysely
        .insertInto("card_messages")
        .values({
          card_id: card.id,
          surface,
          chat_id: String(copy.chatId),
          topic_id: null,
          message_id: String(copy.messageId),
          sent_at: copy.sentAtMs,
        })
        .orIgnore(),
    );
    return null;
  },
});

/** The copies of the card version with this callback reference, in the order they were sent. */
export const findCardCopiesTask: StoreTask<string, readonly CardCopy[]> = defineTask({
  name: "telegram.find_card_copies",
  access: "read",
  input: z.string(),
  output: z.array(cardCopySchema),
  run(database, ref) {
    const { sync, query } = copiesQuery(database);
    const ordered = query
      .where("cards.callback_ref", "=", ref)
      .orderBy("card_messages.sent_at")
      .orderBy("card_messages.message_id");
    return sync.execute(ordered).rows.map((row) => copyRowSchema.parse(row));
  },
});

/** The copies of every version of an intent's card, the oldest version first. */
export const intentCardCopiesTask: StoreTask<Id<"int">, readonly CardCopy[]> = defineTask({
  name: "telegram.intent_card_copies",
  access: "read",
  input: idSchema("int"),
  output: z.array(cardCopySchema),
  run(database, intent) {
    const { sync, query } = copiesQuery(database);
    const ordered = query
      .where("cards.intent_id", "=", intent)
      .orderBy("cards.version")
      .orderBy("card_messages.sent_at")
      .orderBy("card_messages.message_id");
    return sync.execute(ordered).rows.map((row) => copyRowSchema.parse(row));
  },
});
