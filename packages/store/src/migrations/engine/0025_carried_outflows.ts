import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The value is a decimal
// string of micro-dollars, as `intents.value_usd_micros` holds it. The intent id has no foreign
// key: the intent it names may be one the restored copy does not hold.
const sql = `
CREATE TABLE carried_outflows (
  intent_id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  paper INTEGER NOT NULL CHECK (paper IN (0, 1)),
  confirmed_at INTEGER NOT NULL,
  value_usd_micros TEXT NOT NULL CHECK (
    value_usd_micros != ''
    AND value_usd_micros NOT GLOB '*[^0-9]*'
    AND (value_usd_micros = '0' OR value_usd_micros NOT GLOB '0*')
    AND length(value_usd_micros) <= 78
  ),
  carried_at INTEGER NOT NULL
) STRICT;

CREATE INDEX carried_outflows_agent ON carried_outflows (agent_id, paper, confirmed_at);
`;

/**
 * Creates `carried_outflows`: the outflows the rolling 24-hour cap counted in the state a restore
 * replaced, which it keeps counting in the restored one (keys spec, section 7.4), each in the
 * place of the restored copy's count of the same intent.
 */
export const migration: Migration = {
  name: "0025_carried_outflows",
  up(database) {
    database.exec(sql);
  },
};
