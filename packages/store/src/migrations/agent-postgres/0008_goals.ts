import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE goals (
  session_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id text COLLATE "C" NOT NULL,
  objective text COLLATE "C" NOT NULL CHECK (length(objective) BETWEEN 1 AND 2000),
  status text COLLATE "C" NOT NULL CHECK (status IN ('active', 'paused', 'blocked', 'complete')),
  pause_reason text COLLATE "C" CHECK (
    pause_reason IS NULL OR length(pause_reason) BETWEEN 1 AND 40
  ),
  note text COLLATE "C" CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  budget_micros numeric(78,0) CHECK (budget_micros IS NULL OR budget_micros > 0),
  spent_micros numeric(78,0) NOT NULL CHECK (spent_micros >= 0),
  goal_turns bigint NOT NULL CHECK (goal_turns >= 0),
  strikes bigint NOT NULL CHECK (strikes >= 0),
  started_at bigint NOT NULL CHECK (started_at >= 0),
  updated_at bigint NOT NULL CHECK (updated_at >= started_at),
  version bigint NOT NULL CHECK (version >= 0),
  CHECK ((status = 'paused') = (pause_reason IS NOT NULL))
);

CREATE TABLE progress_notes (
  session_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id text COLLATE "C" NOT NULL,
  markdown text COLLATE "C" NOT NULL CHECK (length(markdown) <= 2000),
  plan text COLLATE "C" NOT NULL CHECK (plan IS JSON ARRAY),
  updated_at bigint NOT NULL CHECK (updated_at >= 0)
);
`;

/** Adds `goals` and `progress_notes` (decision 0407), as agent 0008 does. */
export const migration: PostgresMigration = { name: "0008_goals", sql };
