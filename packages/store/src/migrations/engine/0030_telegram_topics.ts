import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. One row per agent and
// chat; a row appears when the owner's bot makes the agent's topic, and goes when Telegram says
// the topic is gone.
const sql = `
CREATE TABLE telegram_topics (
  agent_id TEXT NOT NULL REFERENCES agents (id),
  chat_id INTEGER NOT NULL CHECK (chat_id > 0),
  thread_id INTEGER NOT NULL CHECK (thread_id > 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, chat_id)
) STRICT;
`;

/**
 * Creates `telegram_topics`: the topic the owner's bot made for each agent in the owner's chat,
 * so an agent keeps one topic across restarts (decision 0186).
 */
export const migration: Migration = {
  name: "0030_telegram_topics",
  up(database) {
    database.exec(sql);
  },
};
