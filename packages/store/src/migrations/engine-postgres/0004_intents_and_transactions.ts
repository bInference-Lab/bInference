import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. A write-order key takes
// its next value from its `counters` row in the insert's own transaction (decision 0366); a
// value the insert names moves the counter past it.
const sql = `
CREATE TABLE intents (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  kind text COLLATE "C" NOT NULL,
  state text COLLATE "C" NOT NULL,
  reason text COLLATE "C",
  request text COLLATE "C" CHECK (request IS JSON) NOT NULL,
  plan text COLLATE "C" CHECK (plan IS JSON),
  quote text COLLATE "C" CHECK (quote IS JSON),
  risk text COLLATE "C" CHECK (risk IS JSON),
  simulation text COLLATE "C" CHECK (simulation IS JSON),
  authorized_by text COLLATE "C" CHECK (authorized_by IS JSON),
  outside_content smallint NOT NULL CHECK (outside_content IN (0, 1)),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  proposer text COLLATE "C" NOT NULL CHECK (
    proposer IN ('telegram', 'engine') OR proposer ~ '^tok_' OR proposer ~ '^dev_'
  ),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE INDEX intents_agent_state ON intents (agent_id, state);
CREATE INDEX intents_state_changed ON intents (state, changed_at);

CREATE TABLE intent_events (
  id bigint PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  from_state text COLLATE "C",
  to_state text COLLATE "C" NOT NULL,
  cause text COLLATE "C" CHECK (cause IS JSON) NOT NULL,
  at bigint NOT NULL
);

CREATE INDEX intent_events_intent_at ON intent_events (intent_id, at);

CREATE FUNCTION intent_events_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('intent_events', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('intent_events', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER intent_events_id_next BEFORE INSERT ON intent_events
  FOR EACH ROW EXECUTE FUNCTION intent_events_id_next();

CREATE TABLE cards (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  version bigint NOT NULL CHECK (version >= 1),
  terms_hash text COLLATE "C" NOT NULL
    CHECK (length(terms_hash) = 64 AND terms_hash !~ '[^0-9a-f]'),
  callback_ref text COLLATE "C" UNIQUE,
  opened_at bigint NOT NULL,
  expires_at bigint NOT NULL,
  closed_at bigint,
  close_reason text COLLATE "C",
  UNIQUE (intent_id, version),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL))
);

CREATE TABLE card_messages (
  card_id text COLLATE "C" NOT NULL REFERENCES cards (id),
  surface text COLLATE "C" NOT NULL CHECK (surface IN ('telegram', 'console', 'mini')),
  chat_id text COLLATE "C",
  topic_id text COLLATE "C",
  message_id text COLLATE "C" NOT NULL,
  sent_at bigint NOT NULL,
  PRIMARY KEY (card_id, surface, message_id)
);

CREATE TABLE confirmations (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL UNIQUE REFERENCES intents (id),
  card_id text COLLATE "C" NOT NULL REFERENCES cards (id),
  card_version bigint NOT NULL,
  terms_hash text COLLATE "C" NOT NULL
    CHECK (length(terms_hash) = 64 AND terms_hash !~ '[^0-9a-f]'),
  by_surface text COLLATE "C" NOT NULL,
  by_ref text COLLATE "C" NOT NULL,
  at bigint NOT NULL,
  expires_at bigint NOT NULL,
  FOREIGN KEY (intent_id, card_version) REFERENCES cards (intent_id, version)
);

CREATE TABLE txs (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  step bigint NOT NULL CHECK (step >= 0),
  chain text COLLATE "C" NOT NULL,
  account text COLLATE "C" NOT NULL,
  nonce bigint NOT NULL CHECK (nonce >= 0),
  state text COLLATE "C" NOT NULL,
  raw text COLLATE "C",
  hash text COLLATE "C",
  gas_price numeric(78,0) CHECK (gas_price >= 0),
  relays text COLLATE "C" CHECK (relays IS JSON),
  supersedes text COLLATE "C" REFERENCES txs (id),
  block_number bigint CHECK (block_number >= 0),
  receipt text COLLATE "C" CHECK (receipt IS JSON),
  signed_at bigint,
  sent_at bigint,
  included_at bigint,
  final_at bigint
);

CREATE UNIQUE INDEX txs_account_nonce ON txs (account, nonce)
  WHERE state IN ('signed', 'sent', 'included', 'final');
CREATE INDEX txs_hash ON txs (hash);
CREATE INDEX txs_intent_step ON txs (intent_id, step);

CREATE TABLE executions (
  id bigint PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  asset_in text COLLATE "C" NOT NULL,
  amount_in numeric(78,0) NOT NULL CHECK (amount_in >= 0),
  asset_out text COLLATE "C" NOT NULL,
  amount_out numeric(78,0) NOT NULL CHECK (amount_out >= 0),
  price_usd_micros numeric(78,0) NOT NULL CHECK (price_usd_micros >= 0),
  fee_usd_micros numeric(78,0) NOT NULL CHECK (fee_usd_micros >= 0),
  gas_usd_micros numeric(78,0) NOT NULL CHECK (gas_usd_micros >= 0),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  at bigint NOT NULL
);

CREATE INDEX executions_wallet_at ON executions (wallet_id, at);

CREATE FUNCTION executions_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('executions', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('executions', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER executions_id_next BEFORE INSERT ON executions
  FOR EACH ROW EXECUTE FUNCTION executions_id_next();

CREATE TABLE positions (
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  asset text COLLATE "C" NOT NULL,
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  quantity numeric(78,0) NOT NULL CHECK (quantity >= 0),
  cost_usd_micros numeric(78,0) NOT NULL CHECK (cost_usd_micros >= 0),
  realized_usd_micros numeric(78,0) NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet_id, asset, paper)
);
`;

/** Creates intents and what they leave behind (database spec, section 2.3), as engine 0004 does. */
export const migration: PostgresMigration = { name: "0004_intents_and_transactions", sql };
