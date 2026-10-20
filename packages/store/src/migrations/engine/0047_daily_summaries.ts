import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A total is decimal text
// of micro-dollars, never negative, and NULL when it could not be read.
const total = (column: string): string =>
  `${column} TEXT CHECK (${column} IS NULL OR (` +
  `${column} != '' AND ${column} NOT GLOB '*[^0-9]*' ` +
  `AND (${column} = '0' OR ${column} NOT GLOB '0*') AND length(${column}) <= 78))`;

const sql = `
CREATE TABLE daily_summaries (
  agent_id TEXT NOT NULL REFERENCES agents (id),
  date TEXT NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'idle')),
  ${total("live_usd_micros")},
  ${total("paper_usd_micros")},
  PRIMARY KEY (agent_id, date)
) STRICT;
`;

/**
 * Creates `daily_summaries`: each agent's daily summary of each owner's date, sent or found idle,
 * with the live and paper totals it read, so a summary goes out once per date across a restart
 * and the next one measures its 24-hour change.
 */
export const migration: Migration = {
  name: "0047_daily_summaries",
  up(database) {
    database.exec(sql);
  },
};
