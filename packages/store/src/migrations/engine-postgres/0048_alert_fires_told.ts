import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE alert_fires ADD COLUMN told smallint NOT NULL DEFAULT 0 CHECK (told IN (0, 1));
UPDATE alert_fires SET told = 1
WHERE reason = 'hourly' AND at <= (
  SELECT max(woke.at) FROM alert_fires AS woke
  WHERE woke.agent_id = alert_fires.agent_id AND woke.outcome = 'woke'
);
`;

/** Adds `alert_fires.told`, whether a held wake-up was told, as engine 0048 does. */
export const migration: PostgresMigration = { name: "0048_alert_fires_told", sql };
