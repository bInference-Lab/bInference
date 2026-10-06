import type { Migration } from "../migration.js";

// Each migration keeps its own helpers: a released file never changes, and a helper it shared with
// a later migration could. A hash is 64 lowercase hex digits.
const hash = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;
const fills = `fills INTEGER NOT NULL DEFAULT 0 CHECK (fills >= 0),
  max_fills INTEGER CHECK (max_fills >= 1)`;

const orders = `
CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('awaiting_confirmation', 'active', 'filled', 'cancelled', 'expired', 'ended')
  ),
  ${json("request")} NOT NULL,
  ${json("trigger_state")},
  ${fills},
  expires_at INTEGER,
  card_id TEXT REFERENCES cards (id),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX orders_state_agent ON orders (state, agent_id);

CREATE TABLE order_fills (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders (id),
  intent_id TEXT REFERENCES intents (id),
  outcome TEXT NOT NULL CHECK (outcome IN ('filled', 'skipped')),
  reason TEXT,
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX order_fills_order_at ON order_fills (order_id, at);

CREATE TABLE alerts (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  ${json("condition")} NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('active', 'fired', 'deleted')),
  created_at INTEGER NOT NULL,
  fired_at INTEGER
) STRICT;

CREATE INDEX alerts_state ON alerts (state);
`;

const rules = `
CREATE TABLE webhook_rules (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  name TEXT NOT NULL,
  ${hash("secret_hash")},
  ${json("action")} NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('awaiting_confirmation', 'active', 'deleted')),
  rate_per_min INTEGER NOT NULL CHECK (rate_per_min >= 1),
  ${fills},
  expires_at INTEGER,
  card_id TEXT REFERENCES cards (id),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX webhook_rules_state ON webhook_rules (state);

CREATE TABLE webhook_events (
  id INTEGER PRIMARY KEY NOT NULL,
  rule_id TEXT NOT NULL REFERENCES webhook_rules (id),
  alert_id TEXT,
  ${hash("body_hash")},
  received_at INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'repeat', 'rate', 'rejected')),
  intent_id TEXT REFERENCES intents (id)
) STRICT;

CREATE INDEX webhook_events_rule_received ON webhook_events (rule_id, received_at);
CREATE INDEX webhook_events_rule_alert ON webhook_events (rule_id, alert_id);

CREATE TABLE schedules (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  ${json('"when"')} NOT NULL,
  prompt TEXT NOT NULL,
  next_at INTEGER,
  last_at INTEGER,
  state TEXT NOT NULL CHECK (state IN ('active', 'cancelled')),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE INDEX schedules_state_next ON schedules (state, next_at);
`;

/**
 * Creates what runs without a card each time (database spec, section 2.4): `orders`,
 * `order_fills`, `alerts`, `webhook_rules`, `webhook_events` and `schedules`.
 */
export const migration: Migration = {
  name: "0005_orders_and_rules",
  up(database) {
    database.exec(orders);
    database.exec(rules);
  },
};
