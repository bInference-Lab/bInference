import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The new table first, the
// rows copied, the old one dropped, then renamed, as on SQLite.
const sql = `
CREATE TABLE schedules_new (
  id text COLLATE "C" PRIMARY KEY NOT NULL CHECK (id ~ '^sch_'),
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  "when" text COLLATE "C" CHECK ("when" IS JSON) NOT NULL,
  prompt text COLLATE "C" NOT NULL CHECK (length(prompt) BETWEEN 1 AND 2000),
  state text COLLATE "C" NOT NULL CHECK (state IN ('active', 'cancelled', 'ended')),
  next_at bigint,
  zone text COLLATE "C",
  last_at bigint,
  last_due_at bigint,
  last_outcome text COLLATE "C" CHECK (last_outcome IS NULL OR last_outcome IN ('sent', 'skipped')),
  last_reason text COLLATE "C" CHECK (
    last_reason IS NULL OR last_reason IN ('frozen', 'archived', 'budget', 'waiting', 'busy')
  ),
  last_message_id text COLLATE "C" CHECK (last_message_id IS NULL OR last_message_id ~ '^msg_'),
  created_by text COLLATE "C" NOT NULL,
  outside_content smallint NOT NULL DEFAULT 0 CHECK (outside_content IN (0, 1)),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  CHECK (state != 'active' OR next_at IS NOT NULL)
);

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
ALTER INDEX schedules_new_pkey RENAME TO schedules_pkey;

CREATE INDEX schedules_state_next ON schedules (state, next_at);
CREATE INDEX schedules_agent_state ON schedules (agent_id, state);

CREATE TABLE schedule_runs (
  schedule_id text COLLATE "C" NOT NULL REFERENCES schedules (id),
  due_at bigint NOT NULL,
  at bigint NOT NULL,
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('sent', 'skipped')),
  reason text COLLATE "C" CHECK (
    reason IS NULL OR reason IN ('frozen', 'archived', 'budget', 'waiting', 'busy')
  ),
  message_id text COLLATE "C" CHECK (message_id IS NULL OR message_id ~ '^msg_'),
  CHECK ((outcome = 'sent') = (reason IS NULL AND message_id IS NOT NULL)),
  PRIMARY KEY (schedule_id, due_at)
);

CREATE INDEX schedule_runs_at ON schedule_runs (at);
`;

/**
 * Makes `schedules` again with its zone, its last run and the outside-content mark, and creates
 * `schedule_runs`, as engine 0040 does.
 */
export const migration: PostgresMigration = { name: "0040_schedule_runs", sql };
