import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot add
// AUTOINCREMENT to a key in place, so `webhook_events` is made again: the new table first, its
// rows copied, the old one dropped, then renamed, all in the migration's one transaction.
const sql = `
ALTER TABLE webhook_rules ADD COLUMN last_alert_at INTEGER;

CREATE TABLE webhook_events_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  rule_id TEXT NOT NULL REFERENCES webhook_rules (id),
  alert_id TEXT,
  body_hash TEXT NOT NULL CHECK (length(body_hash) = 64 AND body_hash NOT GLOB '*[^0-9a-f]*'),
  received_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'repeat', 'rate', 'rejected')),
  intent_id TEXT REFERENCES intents (id)
) STRICT;

INSERT INTO webhook_events_new (id, rule_id, alert_id, body_hash, received_at, outcome, intent_id)
SELECT id, rule_id, alert_id, body_hash, received_at, outcome, intent_id FROM webhook_events;

DROP TABLE webhook_events;
ALTER TABLE webhook_events_new RENAME TO webhook_events;

CREATE INDEX webhook_events_rule_received ON webhook_events (rule_id, received_at);
CREATE INDEX webhook_events_rule_alert ON webhook_events (rule_id, alert_id);
CREATE INDEX webhook_events_rule_outcome_received
  ON webhook_events (rule_id, outcome, received_at);
CREATE INDEX webhook_events_received ON webhook_events (received_at);

CREATE INDEX inbox_handled ON inbox (handled_at) WHERE handled_at IS NOT NULL;
`;

/**
 * Adds `webhook_rules.last_alert_at`, the last accepted alert's time (decision 0299). Makes
 * `webhook_events` again with an id that is never reused, since an accepted alert's inbox entry
 * is keyed on it and outlives the row, and with indexes by rule, outcome and time, so the listener
 * counts a rule's accepted alerts of the last ten minutes without reading its refusals, and by
 * time alone, so the daily prune does not read the whole table. Indexes the inbox's handled
 * entries by when they were handled, for their prune.
 */
export const migration: Migration = {
  name: "0057_webhook_alerts",
  up(database) {
    database.exec(sql);
  },
};
