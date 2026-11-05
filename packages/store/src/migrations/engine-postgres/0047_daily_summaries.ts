import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE daily_summaries (
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  date text COLLATE "C" NOT NULL CHECK (date ~ '^[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]$'),
  at bigint NOT NULL,
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('sent', 'idle')),
  live_usd_micros numeric(78,0) CHECK (live_usd_micros IS NULL OR live_usd_micros >= 0),
  paper_usd_micros numeric(78,0) CHECK (paper_usd_micros IS NULL OR paper_usd_micros >= 0),
  PRIMARY KEY (agent_id, date)
);
`;

/** Creates `daily_summaries`, one per agent and owner's date, as engine 0047 does. */
export const migration: PostgresMigration = { name: "0047_daily_summaries", sql };
