import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE stake_unbondings (
  id bigint PRIMARY KEY,
  intent_id text COLLATE "C" NOT NULL UNIQUE REFERENCES intents (id),
  wallet_id text COLLATE "C" NOT NULL REFERENCES wallets (id),
  venue text COLLATE "C" NOT NULL CHECK (length(venue) BETWEEN 1 AND 200),
  validator text COLLATE "C",
  request_ref text COLLATE "C" NOT NULL CHECK (length(request_ref) BETWEEN 1 AND 200),
  asset text COLLATE "C" NOT NULL,
  amount numeric(78,0) NOT NULL CHECK (amount >= 0),
  value_usd_micros numeric(78,0) CHECK (value_usd_micros IS NULL OR value_usd_micros >= 0),
  ready_at bigint NOT NULL,
  claim_intent_id text COLLATE "C" REFERENCES intents (id),
  claimed_at bigint,
  told_ready_at bigint,
  paper smallint NOT NULL CHECK (paper IN (0, 1)),
  CHECK ((claim_intent_id IS NULL) = (claimed_at IS NULL))
);

CREATE UNIQUE INDEX stake_unbondings_request
  ON stake_unbondings (venue, wallet_id, paper, request_ref);
CREATE INDEX stake_unbondings_open ON stake_unbondings (wallet_id, paper, venue, ready_at)
  WHERE claim_intent_id IS NULL;
CREATE INDEX stake_unbondings_claim ON stake_unbondings (claim_intent_id)
  WHERE claim_intent_id IS NOT NULL;
CREATE INDEX stake_unbondings_untold ON stake_unbondings (ready_at)
  WHERE claim_intent_id IS NULL AND told_ready_at IS NULL;

CREATE OR REPLACE FUNCTION stake_unbondings_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('stake_unbondings', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('stake_unbondings', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER stake_unbondings_id_next BEFORE INSERT ON stake_unbondings
  FOR EACH ROW EXECUTE FUNCTION stake_unbondings_id_next();
`;

/** Creates `stake_unbondings`, each unstake until it is claimed, as engine 0055 does. */
export const migration: PostgresMigration = { name: "0055_stake_unbondings", sql };
