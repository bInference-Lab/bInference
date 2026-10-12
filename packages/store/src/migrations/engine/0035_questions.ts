import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. At most one open question
// per agent, which the partial unique index keeps; each surface's copy of a question once.
const sql = `
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  session_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  text TEXT NOT NULL,
  choices TEXT NOT NULL CHECK (json_valid(choices)),
  ref TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
  answer TEXT CHECK (answer IS NULL OR json_valid(answer)),
  close_reason TEXT CHECK (close_reason IS NULL OR close_reason IN ('replaced', 'cleared', 'expired')),
  created_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  closed_at INTEGER
) STRICT;

CREATE UNIQUE INDEX questions_open_agent ON questions (agent_id) WHERE state = 'open';

CREATE TABLE question_messages (
  question_id TEXT NOT NULL REFERENCES questions (id),
  surface TEXT NOT NULL CHECK (surface IN ('telegram', 'console', 'mini')),
  chat_id INTEGER NOT NULL,
  topic_id INTEGER,
  message_id INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (question_id, surface, chat_id)
) STRICT;
`;

/**
 * Creates `questions`, the agent's questions to the owner, and `question_messages`, each surface's
 * copy of one, so every copy loses its buttons once the question closes, after a restart too.
 */
export const migration: Migration = {
  name: "0035_questions",
  up(database) {
    database.exec(sql);
  },
};
