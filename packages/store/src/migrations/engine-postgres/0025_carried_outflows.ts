import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE carried_outflows (
  intent_id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  confirmed_at bigint NOT NULL,
  value_usd_micros numeric(78,0) NOT NULL CHECK (value_usd_micros >= 0),
  carried_at bigint NOT NULL
);

CREATE INDEX carried_outflows_agent ON carried_outflows (agent_id, paper, confirmed_at);
`;

/**
 * Creates `carried_outflows`, confirmed outflows a restore carries into the 24-hour cap, as engine
 * 0025 does.
 */
export const migration: PostgresMigration = { name: "0025_carried_outflows", sql };
