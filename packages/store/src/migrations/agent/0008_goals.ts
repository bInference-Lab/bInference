import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A chat has at most one
// goal and one progress note, each kept under its session's id. Money is a decimal string of
// micro-dollars with no leading zero; a budget, when set, is above zero. A plan is a JSON array.
const sql = `
CREATE TABLE goals (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id TEXT NOT NULL,
  objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 2000),
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'blocked', 'complete')),
  pause_reason TEXT CHECK (pause_reason IS NULL OR length(pause_reason) BETWEEN 1 AND 40),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 2000),
  budget_micros TEXT CHECK (budget_micros IS NULL OR (
    budget_micros != '' AND budget_micros NOT GLOB '*[^0-9]*' AND budget_micros NOT GLOB '0*'
    AND length(budget_micros) <= 78
  )),
  spent_micros TEXT NOT NULL CHECK (
    spent_micros != '' AND spent_micros NOT GLOB '*[^0-9]*'
    AND (spent_micros = '0' OR spent_micros NOT GLOB '0*') AND length(spent_micros) <= 78
  ),
  goal_turns INTEGER NOT NULL CHECK (goal_turns >= 0),
  strikes INTEGER NOT NULL CHECK (strikes >= 0),
  started_at INTEGER NOT NULL CHECK (started_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= started_at),
  version INTEGER NOT NULL CHECK (version >= 0),
  CHECK ((status = 'paused') = (pause_reason IS NOT NULL))
) STRICT;

CREATE TABLE progress_notes (
  session_id TEXT PRIMARY KEY NOT NULL REFERENCES sessions (id),
  agent_id TEXT NOT NULL,
  markdown TEXT NOT NULL CHECK (length(markdown) <= 2000),
  plan TEXT NOT NULL CHECK (json_valid(plan) AND json_type(plan) = 'array'),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
) STRICT;
`;

/**
 * Adds `goals` and `progress_notes` (decision 0407): the one goal of a chat, with its objective,
 * status, why it paused, the agent's last note on it, its budget and spend in micro-dollars, its
 * goal turns, the goal turns in a row that made no progress, and its times; and the one progress
 * note of a chat, its markdown and its plan of steps.
 */
export const migration: Migration = {
  name: "0008_goals",
  up(database) {
    database.exec(sql);
  },
};
