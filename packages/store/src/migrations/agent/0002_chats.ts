import type { Migration } from "../migration.js";

const sql = `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL,
  surface TEXT NOT NULL,
  conversation TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  cleared_at INTEGER,
  summary TEXT,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX sessions_agent_conversation ON sessions (agent_id, conversation);

CREATE TABLE turns (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  outcome TEXT CHECK (outcome IN ('ok', 'stopped', 'failed', 'budget', 'loop')),
  committed INTEGER NOT NULL DEFAULT 0 CHECK (committed IN (0, 1)),
  outside_content INTEGER NOT NULL DEFAULT 0 CHECK (outside_content IN (0, 1)),
  model TEXT,
  CHECK ((ended_at IS NULL) = (outcome IS NULL))
) STRICT;

CREATE INDEX turns_session_started ON turns (session_id, started_at);

CREATE TABLE transcript_events (
  id INTEGER PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (id),
  turn_id TEXT REFERENCES turns (id),
  seq INTEGER NOT NULL CHECK (seq >= 1),
  role TEXT NOT NULL CHECK (role IN ('owner', 'agent', 'tool', 'system')),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'tool_call', 'tool_result', 'image', 'summary')),
  content TEXT NOT NULL CHECK (json_valid(content)),
  at INTEGER NOT NULL,
  UNIQUE (session_id, seq)
) STRICT;
`;

/**
 * Creates the chats (database spec, section 3): `sessions`, `turns` and `transcript_events`. The
 * agent id names a row of the engine database, so no foreign key holds it.
 */
export const migration: Migration = {
  name: "0002_chats",
  up(database) {
    database.exec(sql);
  },
};
