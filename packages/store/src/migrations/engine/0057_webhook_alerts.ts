import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE webhook_rules ADD COLUMN last_alert_at INTEGER;

CREATE INDEX webhook_events_rule_outcome_received
  ON webhook_events (rule_id, outcome, received_at);
`;

/**
 * Adds `webhook_rules.last_alert_at`, the last accepted alert's time (decision 0299), and an index
 * on `webhook_events` by rule, outcome and time, so the listener counts a rule's accepted alerts
 * of the last ten minutes without reading the repeats and the alerts over its rate.
 */
export const migration: Migration = {
  name: "0057_webhook_alerts",
  up(database) {
    database.exec(sql);
  },
};
