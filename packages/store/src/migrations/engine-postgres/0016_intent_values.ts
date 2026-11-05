import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE intents ADD COLUMN value_usd_micros numeric(78,0) CHECK (
  value_usd_micros IS NULL OR value_usd_micros >= 0
);

CREATE INDEX intent_events_state_at ON intent_events (to_state, at);
`;

/**
 * Adds `intents.value_usd_micros` and the index of intent events by state and time, as engine 0016
 * does.
 */
export const migration: PostgresMigration = { name: "0016_intent_values", sql };
