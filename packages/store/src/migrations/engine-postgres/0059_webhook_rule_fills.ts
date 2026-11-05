import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. A column's check may
// read the row's other columns, which Postgres, like SQLite, takes as a check of the row.
const sql = `
ALTER TABLE webhook_rules ADD COLUMN wallet_id text COLLATE "C" REFERENCES wallets (id);
ALTER TABLE webhook_rules ADD COLUMN intent_id text COLLATE "C";
ALTER TABLE webhook_rules ADD COLUMN paper smallint NOT NULL DEFAULT 1 CHECK (paper IN (0, 1));
ALTER TABLE webhook_rules ADD COLUMN url_changed_at bigint;
ALTER TABLE webhook_rules ADD COLUMN old_url_last_event bigint NOT NULL DEFAULT 0
  CHECK (old_url_last_event >= 0);
ALTER TABLE webhook_rules ADD COLUMN notice_window_at bigint;
ALTER TABLE webhook_rules ADD COLUMN notices_sent bigint NOT NULL DEFAULT 0
  CHECK (notices_sent >= 0);
ALTER TABLE webhook_rules ADD COLUMN notices_held bigint NOT NULL DEFAULT 0
  CHECK (notices_held >= 0);

CREATE UNIQUE INDEX webhook_rules_intent ON webhook_rules (intent_id) WHERE intent_id IS NOT NULL;
CREATE INDEX webhook_rules_agent_state ON webhook_rules (agent_id, state);

ALTER TABLE webhook_events ADD COLUMN engine_locked smallint NOT NULL DEFAULT 0
  CHECK (engine_locked IN (0, 1));
ALTER TABLE webhook_events ADD COLUMN fill_outcome text COLLATE "C"
  CHECK (fill_outcome IS NULL OR (fill_outcome IN ('filled', 'skipped') AND outcome = 'accepted'
    AND (fill_outcome = 'skipped' OR intent_id IS NOT NULL)));
ALTER TABLE webhook_events ADD COLUMN fill_reason text COLLATE "C"
  CHECK (CASE fill_outcome WHEN 'skipped'
    THEN fill_reason IS NOT NULL AND fill_reason <> '' AND fill_reason !~ '[^a-z_]'
    ELSE fill_reason IS NULL END);
ALTER TABLE webhook_events ADD COLUMN notices text COLLATE "C"
  CHECK (notices IS NULL OR (notices IS JSON AND fill_outcome IS NOT NULL));
ALTER TABLE webhook_events ADD COLUMN announced_at bigint
  CHECK (announced_at IS NULL OR notices IS NOT NULL);

CREATE UNIQUE INDEX webhook_events_intent ON webhook_events (intent_id)
  WHERE intent_id IS NOT NULL;
CREATE INDEX webhook_events_unannounced ON webhook_events (id)
  WHERE notices IS NOT NULL AND announced_at IS NULL;
`;

/**
 * Adds a webhook rule's wallet, intent, paper mode, URL change and notice window, and each event's
 * fill, as engine 0059 does.
 */
export const migration: PostgresMigration = { name: "0059_webhook_rule_fills", sql };
