import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE telegram_topics (
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  chat_id bigint NOT NULL CHECK (chat_id > 0),
  thread_id bigint NOT NULL CHECK (thread_id > 0),
  created_at bigint NOT NULL,
  PRIMARY KEY (agent_id, chat_id)
);
`;

/** Creates `telegram_topics`, one per agent and chat, as engine 0030 does. */
export const migration: PostgresMigration = { name: "0030_telegram_topics", sql };
