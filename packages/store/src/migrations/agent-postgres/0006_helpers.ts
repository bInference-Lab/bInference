import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE helpers (
  id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id text COLLATE "C" NOT NULL,
  parent_session_id text COLLATE "C" NOT NULL REFERENCES sessions (id),
  label text COLLATE "C" NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  model text COLLATE "C" CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200),
  state text COLLATE "C" NOT NULL CHECK (
    state IN ('running', 'done', 'failed', 'stopped', 'timed_out')
  ),
  started_at bigint NOT NULL CHECK (started_at >= 0),
  ended_at bigint CHECK (ended_at IS NULL OR ended_at >= started_at),
  timeout_ms bigint NOT NULL CHECK (timeout_ms > 0),
  runs bigint NOT NULL CHECK (runs >= 1),
  outside smallint NOT NULL DEFAULT 0 CHECK (outside IN (0, 1)),
  CHECK ((state = 'running') = (ended_at IS NULL))
);

CREATE INDEX helpers_agent_started ON helpers (agent_id, started_at);
`;

/** Adds `helpers` (decision 0403), as agent 0006 does. */
export const migration: PostgresMigration = { name: "0006_helpers", sql };
