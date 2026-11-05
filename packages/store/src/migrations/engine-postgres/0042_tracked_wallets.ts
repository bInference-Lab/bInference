import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Blocks and amounts are
// numeric(78,0). A wallet's trades are kept once per account, transaction and log index.
const sql = `
CREATE TABLE tracked_wallets (
  account text COLLATE "C" PRIMARY KEY NOT NULL,
  since_block numeric(78,0) CHECK (since_block IS NULL OR since_block >= 0),
  last_block numeric(78,0) CHECK (last_block IS NULL OR last_block >= 0),
  overflow_blocks bigint NOT NULL DEFAULT 0 CHECK (overflow_blocks >= 0),
  added_at bigint NOT NULL,
  untracked_at bigint
);

CREATE TABLE wallet_activity (
  id bigint PRIMARY KEY NOT NULL,
  account text COLLATE "C" NOT NULL,
  block numeric(78,0) NOT NULL CHECK (block >= 0),
  tx_hash text COLLATE "C" NOT NULL,
  log_index bigint NOT NULL CHECK (log_index >= 0),
  side text COLLATE "C" NOT NULL CHECK (side IN ('buy', 'sell')),
  asset text COLLATE "C" NOT NULL,
  amount numeric(78,0) NOT NULL CHECK (amount >= 0),
  counter_asset text COLLATE "C" NOT NULL,
  counter_amount numeric(78,0) NOT NULL CHECK (counter_amount >= 0),
  value_usd_micros numeric(78,0) CHECK (value_usd_micros IS NULL OR value_usd_micros >= 0),
  share_sold_bps bigint CHECK (share_sold_bps IS NULL OR share_sold_bps BETWEEN 0 AND 10000),
  venue text COLLATE "C",
  at bigint NOT NULL
);

CREATE UNIQUE INDEX wallet_activity_key ON wallet_activity (account, tx_hash, log_index);
CREATE INDEX wallet_activity_account_at ON wallet_activity (account, at);

CREATE OR REPLACE FUNCTION wallet_activity_id_next() RETURNS trigger LANGUAGE plpgsql
SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.id IS NULL THEN
    INSERT INTO counters AS c (name, last) VALUES ('wallet_activity', 1)
      ON CONFLICT (name) DO UPDATE SET last = c.last + 1 RETURNING c.last INTO NEW.id;
  ELSE
    INSERT INTO counters AS c (name, last) VALUES ('wallet_activity', NEW.id)
      ON CONFLICT (name) DO UPDATE SET last = greatest(c.last, NEW.id);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER wallet_activity_id_next BEFORE INSERT ON wallet_activity
  FOR EACH ROW EXECUTE FUNCTION wallet_activity_id_next();

CREATE TABLE watch_cursors (
  watcher text COLLATE "C" NOT NULL CHECK (watcher IN ('launches', 'wallets')),
  chain text COLLATE "C" NOT NULL,
  block numeric(78,0) NOT NULL CHECK (block >= 0),
  block_hash text COLLATE "C" NOT NULL,
  at bigint NOT NULL,
  PRIMARY KEY (watcher, chain)
);

INSERT INTO tracked_wallets (account, added_at)
SELECT alerts.account, min(alerts.created_at)
FROM alerts JOIN agents ON agents.id = alerts.agent_id
WHERE alerts.state = 'active' AND alerts.account IS NOT NULL AND agents.archived_at IS NULL
GROUP BY alerts.account;
`;

/**
 * Creates `tracked_wallets`, `wallet_activity` and `watch_cursors`, and tracks the accounts of the
 * active wallet alerts, as engine 0042 does.
 */
export const migration: PostgresMigration = { name: "0042_tracked_wallets", sql };
