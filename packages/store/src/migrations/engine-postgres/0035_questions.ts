import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE questions (
  id text COLLATE "C" PRIMARY KEY,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  session_id text COLLATE "C" NOT NULL,
  turn_id text COLLATE "C" NOT NULL,
  text text COLLATE "C" NOT NULL,
  choices text COLLATE "C" NOT NULL CHECK (choices IS JSON),
  ref text COLLATE "C" NOT NULL UNIQUE,
  state text COLLATE "C" NOT NULL CHECK (state IN ('open', 'answered', 'closed')),
  answer text COLLATE "C" CHECK (answer IS NULL OR answer IS JSON),
  close_reason text COLLATE "C"
    CHECK (close_reason IS NULL OR close_reason IN ('replaced', 'cleared', 'expired')),
  created_at bigint NOT NULL,
  closes_at bigint NOT NULL,
  closed_at bigint
);

CREATE UNIQUE INDEX questions_open_agent ON questions (agent_id) WHERE state = 'open';

CREATE TABLE question_messages (
  question_id text COLLATE "C" NOT NULL REFERENCES questions (id),
  surface text COLLATE "C" NOT NULL CHECK (surface IN ('telegram', 'console', 'mini')),
  chat_id bigint NOT NULL,
  topic_id bigint,
  message_id bigint NOT NULL,
  sent_at bigint NOT NULL,
  PRIMARY KEY (question_id, surface, chat_id)
);
`;

/**
 * Creates `questions` and `question_messages`, at most one open question per agent, as engine 0035
 * does.
 */
export const migration: PostgresMigration = { name: "0035_questions", sql };
