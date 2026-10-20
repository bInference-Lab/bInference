import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A wake-up held back before
// the agent's last wake-up counts as told, as the rule before this migration had it.
const sql = `
ALTER TABLE alert_fires ADD COLUMN told INTEGER NOT NULL DEFAULT 0 CHECK (told IN (0, 1));
UPDATE alert_fires SET told = 1
WHERE reason = 'hourly' AND at <= (
  SELECT max(woke.at) FROM alert_fires AS woke
  WHERE woke.agent_id = alert_fires.agent_id AND woke.outcome = 'woke'
);
`;

/**
 * Adds `told` to `alert_fires`: whether a notice told a wake-up the hourly limit held back. The
 * next fire that wakes the agent and whose notice goes out tells every one not yet told
 * (decision 0274).
 */
export const migration: Migration = {
  name: "0048_alert_fires_told",
  up(database) {
    database.exec(sql);
  },
};
