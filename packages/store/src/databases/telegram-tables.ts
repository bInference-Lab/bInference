// The tables of the owner's bot, as SQLite returns them: migration 0004 defines `card_messages`,
// and migration 0019 adds `telegram_owner`.

/** `telegram_owner`: one row, `id = 1`, the owner's numeric Telegram id once paired. */
interface TelegramOwnerTable {
  id: number;
  user_id: number;
  paired_at: number;
}

/** `card_messages`: one posted copy of a card version, on one surface. */
interface CardMessagesTable {
  card_id: string;
  surface: string;
  chat_id: string | null;
  topic_id: string | null;
  message_id: string;
  sent_at: number;
}

/** The owner's bot's tables, by name. */
export interface TelegramTables {
  telegram_owner: TelegramOwnerTable;
  card_messages: CardMessagesTable;
}
