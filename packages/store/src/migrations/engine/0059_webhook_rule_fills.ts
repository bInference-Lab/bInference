import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. No code wrote a rule
// before this migration, so the new columns of `webhook_rules` take defaults no rule relies on.
// A column's check may read the row's other columns, which SQLite takes as a check of the row.
const sql = `
ALTER TABLE webhook_rules ADD COLUMN wallet_id TEXT REFERENCES wallets (id);
ALTER TABLE webhook_rules ADD COLUMN intent_id TEXT;
ALTER TABLE webhook_rules ADD COLUMN paper INTEGER NOT NULL DEFAULT 1 CHECK (paper IN (0, 1));
ALTER TABLE webhook_rules ADD COLUMN url_changed_at INTEGER;
ALTER TABLE webhook_rules ADD COLUMN old_url_last_event INTEGER NOT NULL DEFAULT 0
  CHECK (old_url_last_event >= 0);
ALTER TABLE webhook_rules ADD COLUMN notice_window_at INTEGER;
ALTER TABLE webhook_rules ADD COLUMN notices_sent INTEGER NOT NULL DEFAULT 0
  CHECK (notices_sent >= 0);
ALTER TABLE webhook_rules ADD COLUMN notices_held INTEGER NOT NULL DEFAULT 0
  CHECK (notices_held >= 0);

CREATE UNIQUE INDEX webhook_rules_intent ON webhook_rules (intent_id) WHERE intent_id IS NOT NULL;
CREATE INDEX webhook_rules_agent_state ON webhook_rules (agent_id, state);

ALTER TABLE webhook_events ADD COLUMN engine_locked INTEGER NOT NULL DEFAULT 0
  CHECK (engine_locked IN (0, 1));
ALTER TABLE webhook_events ADD COLUMN fill_outcome TEXT
  CHECK (fill_outcome IS NULL OR (fill_outcome IN ('filled', 'skipped') AND outcome = 'accepted'
    AND (fill_outcome = 'skipped' OR intent_id IS NOT NULL)));
ALTER TABLE webhook_events ADD COLUMN fill_reason TEXT
  CHECK (CASE fill_outcome WHEN 'skipped'
    THEN fill_reason IS NOT NULL AND fill_reason <> '' AND fill_reason NOT GLOB '*[^a-z_]*'
    ELSE fill_reason IS NULL END);
ALTER TABLE webhook_events ADD COLUMN notices TEXT
  CHECK (notices IS NULL OR (json_valid(notices) AND fill_outcome IS NOT NULL));
ALTER TABLE webhook_events ADD COLUMN announced_at INTEGER
  CHECK (announced_at IS NULL OR notices IS NOT NULL);

CREATE UNIQUE INDEX webhook_events_intent ON webhook_events (intent_id)
  WHERE intent_id IS NOT NULL;
CREATE INDEX webhook_events_unannounced ON webhook_events (id)
  WHERE notices IS NOT NULL AND announced_at IS NULL;
`;

/**
 * Keeps what a webhook rule fills with and what became of each alert it accepted (decisions 0336
 * to 0338): each rule's wallet, the `webhookRule` intent that carries its card, the mode it fills
 * in, when its URL last changed and the last alert row its old URL took, and its notice hour; each
 * alert's lock at its arrival, and each accepted alert's fill or skip with its reason, its notices
 * and when they were announced. A skip carries a reason and a fill none but its intent; an intent
 * fills at most one alert, and the alerts whose notices wait are indexed for the start's repair.
 */
export const migration: Migration = {
  name: "0059_webhook_rule_fills",
  up(database) {
    database.exec(sql);
  },
};
