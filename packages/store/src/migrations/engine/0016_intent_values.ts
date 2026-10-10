import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The value is a decimal
// string of micro-dollars, at most 78 digits, with no sign and no leading zero.
const sql = `
ALTER TABLE intents ADD COLUMN value_usd_micros TEXT CHECK (
  value_usd_micros IS NULL OR (
    value_usd_micros != ''
    AND value_usd_micros NOT GLOB '*[^0-9]*'
    AND (value_usd_micros = '0' OR value_usd_micros NOT GLOB '0*')
    AND length(value_usd_micros) <= 78
  )
);

CREATE INDEX intent_events_state_at ON intent_events (to_state, at);
`;

/**
 * Adds `intents.value_usd_micros`: the USD value the policy judged an intent's outflows at, which
 * the rolling 24-hour cap counts from the intent's confirmation (decision 0136), and an index
 * that finds the moves to one state since a time. An intent stored before has no value and is not
 * counted.
 */
export const migration: Migration = {
  name: "0016_intent_values",
  up(database) {
    database.exec(sql);
  },
};
