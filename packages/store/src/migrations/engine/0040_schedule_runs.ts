import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot widen a
// CHECK or add a required column in place, so `schedules` is made again: the new table first, the
// rows copied, the old one dropped, then renamed, in the migration's one transaction. No release
// wrote a schedule before; a row that exists anyway keeps its fields, runs in UTC, and
// ends when it has no next run.
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;
const flag = (column: string): string =>
  `${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} IN (0, 1))`;
const skips = "'frozen', 'archived', 'budget', 'waiting', 'busy'";

const sql = `
CREATE TABLE schedules_new (
  id TEXT PRIMARY KEY NOT NULL CHECK (id GLOB 'sch_*'),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  ${json('"when"')} NOT NULL,
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  state TEXT NOT NULL CHECK (state IN ('active', 'cancelled', 'ended')),
  next_at INTEGER,
  zone TEXT,
  last_at INTEGER,
  last_due_at INTEGER,
  last_outcome TEXT CHECK (last_outcome IS NULL OR last_outcome IN ('sent', 'skipped')),
  last_reason TEXT CHECK (last_reason IS NULL OR last_reason IN (${skips})),
  last_message_id TEXT CHECK (last_message_id IS NULL OR last_message_id GLOB 'msg_*'),
  created_by TEXT NOT NULL,
  ${flag("outside_content")},
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  CHECK (state != 'active' OR next_at IS NOT NULL)
) STRICT;

INSERT INTO schedules_new (
  id, agent_id, "when", prompt, state, next_at, zone, last_at, created_by, created_at, changed_at
)
SELECT
  id, agent_id, "when", prompt,
  CASE WHEN state = 'active' AND next_at IS NULL THEN 'ended' ELSE state END,
  next_at, 'UTC', last_at, created_by, created_at, created_at
FROM schedules;

DROP TABLE schedules;
ALTER TABLE schedules_new RENAME TO schedules;

CREATE INDEX schedules_state_next ON schedules (state, next_at);
CREATE INDEX schedules_agent_state ON schedules (agent_id, state);

CREATE TABLE schedule_runs (
  schedule_id TEXT NOT NULL REFERENCES schedules (id),
  due_at INTEGER NOT NULL,
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'skipped')),
  reason TEXT CHECK (reason IS NULL OR reason IN (${skips})),
  message_id TEXT CHECK (message_id IS NULL OR message_id GLOB 'msg_*'),
  CHECK ((outcome = 'sent') = (reason IS NULL AND message_id IS NOT NULL)),
  PRIMARY KEY (schedule_id, due_at)
) STRICT;

CREATE INDEX schedule_runs_at ON schedule_runs (at);
`;

/**
 * Makes `schedules` again with the zone its next run was worked out in, its last run's outcome,
 * the last wake-up it stored, the outside-content mark and the `ended` state; and creates
 * `schedule_runs`, one row per run, sent or skipped with its reason (decision 0232).
 */
export const migration: Migration = {
  name: "0040_schedule_runs",
  up(database) {
    database.exec(sql);
  },
};
