import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. A transaction hash fits
// the id grammar every family's hashes fit. The rebuild of `executions` would lose its rows, so
// the migration stops when it holds one, and nothing changes.
const sql = `
DO $$ BEGIN
  IF EXISTS (SELECT FROM executions) THEN
    RAISE EXCEPTION 'The executions table holds rows that the rebuild would lose.';
  END IF;
END $$;

DROP TABLE executions;

CREATE TABLE executions (
  id bigint PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  asset_in text COLLATE "C" NOT NULL,
  amount_in numeric(78,0) NOT NULL CHECK (amount_in >= 0),
  fee_amount numeric(78,0) NOT NULL CHECK (fee_amount >= 0),
  asset_out text COLLATE "C" NOT NULL,
  amount_out numeric(78,0) NOT NULL CHECK (amount_out >= 0),
  gas_asset text COLLATE "C" NOT NULL,
  gas_amount numeric(78,0) NOT NULL CHECK (gas_amount >= 0),
  tx_hash text COLLATE "C" CHECK (
    tx_hash IS NULL OR (length(tx_hash) BETWEEN 1 AND 128 AND tx_hash !~ '[^-.%a-zA-Z0-9]')
  ),
  value_usd_micros numeric(78,0) NOT NULL CHECK (value_usd_micros >= 0),
  fee_usd_micros numeric(78,0) NOT NULL CHECK (fee_usd_micros >= 0),
  gas_usd_micros numeric(78,0) NOT NULL CHECK (gas_usd_micros >= 0),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  at bigint NOT NULL
);

CREATE INDEX executions_wallet_at ON executions (wallet_id, at);

CREATE OR REPLACE FUNCTION executions_id_next() RETURNS trigger LANGUAGE plpgsql
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

CREATE TABLE arrivals (
  id bigint PRIMARY KEY NOT NULL,
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  asset text COLLATE "C" NOT NULL,
  amount numeric(78,0) NOT NULL CHECK (amount >= 0),
  value_usd_micros numeric(78,0) CHECK (value_usd_micros IS NULL OR value_usd_micros >= 0),
  tx_hash text COLLATE "C" CHECK (
    tx_hash IS NULL OR (length(tx_hash) BETWEEN 1 AND 128 AND tx_hash !~ '[^-.%a-zA-Z0-9]')
  ),
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  at bigint NOT NULL
);

CREATE INDEX arrivals_wallet_at ON arrivals (wallet_id, at);

CREATE OR REPLACE FUNCTION arrivals_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('arrivals', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('arrivals', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER arrivals_id_next BEFORE INSERT ON arrivals
  FOR EACH ROW EXECUTE FUNCTION arrivals_id_next();

CREATE TABLE departures (
  id bigint PRIMARY KEY NOT NULL,
  intent_id text COLLATE "C" NOT NULL REFERENCES intents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  asset text COLLATE "C" NOT NULL,
  amount numeric(78,0) NOT NULL CHECK (amount >= 0),
  gas_asset text COLLATE "C" NOT NULL,
  gas_amount numeric(78,0) NOT NULL CHECK (gas_amount >= 0),
  tx_hash text COLLATE "C" CHECK (
    tx_hash IS NULL OR (length(tx_hash) BETWEEN 1 AND 128 AND tx_hash !~ '[^-.%a-zA-Z0-9]')
  ) NOT NULL,
  at bigint NOT NULL
);

CREATE INDEX departures_wallet_at ON departures (wallet_id, at);
CREATE INDEX departures_intent ON departures (intent_id);

CREATE OR REPLACE FUNCTION departures_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('departures', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('departures', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER departures_id_next BEFORE INSERT ON departures
  FOR EACH ROW EXECUTE FUNCTION departures_id_next();
`;

/**
 * Makes `executions` again with fees, gas and the settling transaction, and creates `arrivals` and
 * `departures`, as engine 0015 does.
 */
export const migration: PostgresMigration = { name: "0015_positions_and_departures", sql };
