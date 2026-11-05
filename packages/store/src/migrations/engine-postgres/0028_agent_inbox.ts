import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE agents ADD COLUMN chat_session_id text COLLATE "C" CHECK (
  chat_session_id IS NULL OR chat_session_id ~ '^ses_'
);

CREATE TABLE agent_inbox (
  id text COLLATE "C" PRIMARY KEY NOT NULL CHECK (id ~ '^msg_'),
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  session_id text COLLATE "C" NOT NULL CHECK (session_id ~ '^ses_'),
  kind text COLLATE "C" NOT NULL CHECK (kind IN (
    'inbox/message', 'inbox/intentSettled', 'inbox/orderSettled', 'inbox/scheduleDue',
    'inbox/alertFired', 'inbox/resumeReport', 'inbox/stop', 'inbox/clear'
  )),
  turn_id text COLLATE "C" CHECK (turn_id IS NULL OR turn_id ~ '^trn_'),
  payload text COLLATE "C" NOT NULL CHECK (payload IS JSON),
  created_at bigint NOT NULL,
  taken_at bigint
);

CREATE INDEX agent_inbox_untaken ON agent_inbox (agent_id, taken_at);
`;

/** Adds `agents.chat_session_id` and creates `agent_inbox`, as engine 0028 does. */
export const migration: PostgresMigration = { name: "0028_agent_inbox", sql };
