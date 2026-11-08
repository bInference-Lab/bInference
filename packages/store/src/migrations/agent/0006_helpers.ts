import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A helper works in a
// session of its own, so its row names that session; it ends only from `running`, and a new run of
// it moves it back to `running` with a new start and no end.
const sql = `
CREATE TABLE helpers (
  id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id TEXT NOT NULL,
  parent_session_id TEXT NOT NULL REFERENCES sessions (id),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  model TEXT CHECK (model IS NULL OR length(model) BETWEEN 1 AND 200),
  state TEXT NOT NULL CHECK (state IN ('running', 'done', 'failed', 'stopped', 'timed_out')),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  ended_at INTEGER CHECK (ended_at IS NULL OR ended_at >= started_at),
  timeout_ms INTEGER NOT NULL CHECK (timeout_ms > 0),
  runs INTEGER NOT NULL CHECK (runs >= 1),
  outside INTEGER NOT NULL DEFAULT 0 CHECK (outside IN (0, 1)),
  CHECK ((state = 'running') = (ended_at IS NULL))
) STRICT;

CREATE INDEX helpers_agent_started ON helpers (agent_id, started_at);
`;

/**
 * Adds `helpers` (decision 0403): each helper the agent started, the session it works in, the
 * session it was started from, its label, the model it was asked to use, its state, its latest
 * run's start, end and time limit, how many runs it had, and whether it ever read outside content.
 */
export const migration: Migration = {
  name: "0006_helpers",
  up(database) {
    database.exec(sql);
  },
};
