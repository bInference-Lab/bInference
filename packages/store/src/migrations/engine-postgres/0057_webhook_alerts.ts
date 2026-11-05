import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite makes
// `webhook_events` again to give its key AUTOINCREMENT; on Postgres its key takes each value
// from its counter already, so the table stays.
const sql = `
ALTER TABLE webhook_rules ADD COLUMN last_alert_at bigint;

CREATE INDEX webhook_events_rule_outcome_received
  ON webhook_events (rule_id, outcome, received_at);
CREATE INDEX webhook_events_received ON webhook_events (received_at);

CREATE INDEX inbox_handled ON inbox (handled_at) WHERE handled_at IS NOT NULL;
`;

/**
 * Adds `webhook_rules.last_alert_at` and the indexes the webhook listener and the inbox prune read,
 * as engine 0057 does.
 */
export const migration: PostgresMigration = { name: "0057_webhook_alerts", sql };
