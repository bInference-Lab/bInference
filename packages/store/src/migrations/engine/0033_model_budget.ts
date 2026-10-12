import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot add a
// required column in place, so `model_usage` is made again with each attempt's key: the new table
// first, the rows copied, the old one dropped, then renamed, in the migration's one transaction.
// No release wrote model usage before; a row that exists anyway keeps a key made from its id.
const count = (column: string): string =>
  `${column} INTEGER NOT NULL DEFAULT 0 CHECK (${column} >= 0)`;

const sql = `
CREATE TABLE model_usage_new (
  id INTEGER PRIMARY KEY NOT NULL,
  key TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 64),
  agent_id TEXT NOT NULL REFERENCES agents (id),
  turn_id TEXT CHECK (turn_id IS NULL OR turn_id GLOB 'trn_*'),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 128),
  ${count("input_tokens")},
  ${count("output_tokens")},
  ${count("cached_tokens")},
  usd_micros TEXT NOT NULL CHECK (
    usd_micros != '' AND usd_micros NOT GLOB '*[^0-9]*'
    AND (usd_micros = '0' OR usd_micros NOT GLOB '0*') AND length(usd_micros) <= 78
  ),
  at INTEGER NOT NULL
) STRICT;

INSERT INTO model_usage_new (
  id, key, agent_id, turn_id, model, input_tokens, output_tokens, cached_tokens, usd_micros, at
)
SELECT
  id, 'row.' || id, agent_id, turn_id, model, input_tokens, output_tokens, cached_tokens,
  usd_micros, at
FROM model_usage;

DROP TABLE model_usage;
ALTER TABLE model_usage_new RENAME TO model_usage;

CREATE INDEX model_usage_agent_at ON model_usage (agent_id, at);

CREATE TABLE budget_notices (
  agent_id TEXT NOT NULL REFERENCES agents (id),
  day_at INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (agent_id, day_at)
) STRICT;
`;

/**
 * Makes `model_usage` again with `key`, each model call attempt's own key (`<turn>.usage.<n>`),
 * unique, so an attempt is counted once against the daily model budget; and creates
 * `budget_notices`, the owner's days on which each agent's budget was spent and the owner told,
 * so the owner is told once a day.
 */
export const migration: Migration = {
  name: "0033_model_budget",
  up(database) {
    database.exec(sql);
  },
};
