import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE orders (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  kind text COLLATE "C" NOT NULL,
  state text COLLATE "C" NOT NULL CHECK (
    state IN ('awaiting_confirmation', 'active', 'filled', 'cancelled', 'expired', 'ended')
  ),
  request text COLLATE "C" CHECK (request IS JSON) NOT NULL,
  trigger_state text COLLATE "C" CHECK (trigger_state IS JSON),
  fills bigint NOT NULL DEFAULT 0 CHECK (fills >= 0),
  max_fills bigint CHECK (max_fills >= 1),
  expires_at bigint,
  card_id text COLLATE "C" REFERENCES cards (id),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE INDEX orders_state_agent ON orders (state, agent_id);

CREATE TABLE order_fills (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  order_id text COLLATE "C" NOT NULL REFERENCES orders (id),
  intent_id text COLLATE "C" REFERENCES intents (id),
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('filled', 'skipped')),
  reason text COLLATE "C",
  at bigint NOT NULL
);

CREATE INDEX order_fills_order_at ON order_fills (order_id, at);

CREATE TABLE alerts (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  condition text COLLATE "C" CHECK (condition IS JSON) NOT NULL,
  state text COLLATE "C" NOT NULL CHECK (state IN ('active', 'fired', 'deleted')),
  created_at bigint NOT NULL,
  fired_at bigint
);

CREATE INDEX alerts_state ON alerts (state);

CREATE TABLE webhook_rules (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  name text COLLATE "C" NOT NULL,
  secret_hash text COLLATE "C" NOT NULL
    CHECK (length(secret_hash) = 64 AND secret_hash !~ '[^0-9a-f]'),
  action text COLLATE "C" CHECK (action IS JSON) NOT NULL,
  state text COLLATE "C" NOT NULL CHECK (state IN ('awaiting_confirmation', 'active', 'deleted')),
  rate_per_min bigint NOT NULL CHECK (rate_per_min >= 1),
  fills bigint NOT NULL DEFAULT 0 CHECK (fills >= 0),
  max_fills bigint CHECK (max_fills >= 1),
  expires_at bigint,
  card_id text COLLATE "C" REFERENCES cards (id),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE INDEX webhook_rules_state ON webhook_rules (state);

CREATE TABLE webhook_events (
  id bigint PRIMARY KEY NOT NULL,
  rule_id text COLLATE "C" NOT NULL REFERENCES webhook_rules (id),
  alert_id text COLLATE "C",
  body_hash text COLLATE "C" NOT NULL
    CHECK (length(body_hash) = 64 AND body_hash !~ '[^0-9a-f]'),
  received_at bigint NOT NULL,
  outcome text COLLATE "C" NOT NULL CHECK (outcome IN ('accepted', 'repeat', 'rate', 'rejected')),
  intent_id text COLLATE "C" REFERENCES intents (id)
);

CREATE INDEX webhook_events_rule_received ON webhook_events (rule_id, received_at);
CREATE INDEX webhook_events_rule_alert ON webhook_events (rule_id, alert_id);

CREATE FUNCTION webhook_events_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('webhook_events', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('webhook_events', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER webhook_events_id_next BEFORE INSERT ON webhook_events
  FOR EACH ROW EXECUTE FUNCTION webhook_events_id_next();

CREATE TABLE schedules (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  "when" text COLLATE "C" CHECK ("when" IS JSON) NOT NULL,
  prompt text COLLATE "C" NOT NULL,
  next_at bigint,
  last_at bigint,
  state text COLLATE "C" NOT NULL CHECK (state IN ('active', 'cancelled')),
  created_by text COLLATE "C" NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX schedules_state_next ON schedules (state, next_at);
`;

/** Creates what runs without a card each time (database spec, section 2.4), as engine 0005 does. */
export const migration: PostgresMigration = { name: "0005_orders_and_rules", sql };
