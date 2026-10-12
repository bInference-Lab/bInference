// The tables of the owner's bot, as SQLite returns them: migration 0004 defines `card_messages`,
// migration 0019 adds `telegram_owner`, and migration 0030 `telegram_topics`.

/** `telegram_owner`: one row, `id = 1`, the owner's numeric Telegram id once paired. */
interface TelegramOwnerTable {
  id: number;
  user_id: number;
  paired_at: number;
}

/** `telegram_topics`: the topic the owner's bot made for one agent in one chat. */
interface TelegramTopicsTable {
  agent_id: string;
  chat_id: number;
  thread_id: number;
  created_at: number;
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
  telegram_topics: TelegramTopicsTable;
  card_messages: CardMessagesTable;
}
