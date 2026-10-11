import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Each kind is an `inbox`
// push kind of the protocol; the ids carry their protocol prefixes.
const sql = `
ALTER TABLE agents ADD COLUMN chat_session_id TEXT CHECK (
  chat_session_id IS NULL OR chat_session_id GLOB 'ses_*'
);

CREATE TABLE agent_inbox (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'msg_*'),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  session_id TEXT NOT NULL CHECK (session_id GLOB 'ses_*'),
  kind TEXT NOT NULL CHECK (kind IN (
    'inbox/message', 'inbox/intentSettled', 'inbox/orderSettled', 'inbox/scheduleDue',
    'inbox/alertFired', 'inbox/resumeReport', 'inbox/stop', 'inbox/clear'
  )),
  turn_id TEXT CHECK (turn_id IS NULL OR turn_id GLOB 'trn_*'),
  payload TEXT NOT NULL CHECK (json_valid(payload)),
  created_at INTEGER NOT NULL,
  taken_at INTEGER
) STRICT;

CREATE INDEX agent_inbox_untaken ON agent_inbox (agent_id, taken_at);
`;

/**
 * Creates `agent_inbox`, every message for the agent runtime until it takes it, and adds
 * `agents.chat_session_id`, each agent's open chat session (runtime spec, sections 3.1 and 3.2).
 */
export const migration: Migration = {
  name: "0028_agent_inbox",
  up(database) {
    database.exec(sql);
  },
};
