import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. A transaction hash fits
// the id grammar every family's hashes fit.
const sql = `
CREATE TABLE bridges (
  intent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES intents (id),
  venue text COLLATE "C" NOT NULL CHECK (length(venue) BETWEEN 1 AND 200),
  deposit_ref text COLLATE "C" NOT NULL
    CHECK (length(deposit_ref) BETWEEN 1 AND 128 AND deposit_ref !~ '[^-.%a-zA-Z0-9]'),
  to_chain text COLLATE "C" NOT NULL,
  recipient text COLLATE "C" NOT NULL,
  sent_asset text COLLATE "C" NOT NULL,
  sent_amount numeric(78,0) NOT NULL CHECK (sent_amount >= 0),
  delivered_asset text COLLATE "C" NOT NULL,
  delivered_coin text COLLATE "C",
  min_out numeric(78,0) NOT NULL CHECK (min_out >= 0),
  value_usd_micros numeric(78,0) CHECK (value_usd_micros IS NULL OR value_usd_micros >= 0),
  state text COLLATE "C" NOT NULL CHECK (state IN ('in_transit', 'late', 'delivered', 'refunded')),
  status_url text COLLATE "C" CHECK (status_url IS NULL OR length(status_url) BETWEEN 1 AND 2000),
  sent_at bigint NOT NULL,
  late_at bigint,
  fill_tx text COLLATE "C" CHECK (
    fill_tx IS NULL OR (length(fill_tx) BETWEEN 1 AND 128 AND fill_tx !~ '[^-.%a-zA-Z0-9]')
  ),
  received numeric(78,0) CHECK (received IS NULL OR received >= 0),
  received_asset text COLLATE "C",
  refund_tx text COLLATE "C" CHECK (
    refund_tx IS NULL OR (length(refund_tx) BETWEEN 1 AND 128 AND refund_tx !~ '[^-.%a-zA-Z0-9]')
  ),
  settled_at bigint,
  checked_at bigint,
  version bigint NOT NULL CHECK (version >= 0),
  CHECK ((received IS NULL) = (received_asset IS NULL))
);

CREATE INDEX bridges_state ON bridges (state, sent_at);
CREATE UNIQUE INDEX bridges_fill ON bridges (to_chain, fill_tx) WHERE fill_tx IS NOT NULL;
CREATE UNIQUE INDEX bridges_refund ON bridges (refund_tx) WHERE refund_tx IS NOT NULL;
`;

/** Creates `bridges`, each bridge in transit and how it ended, as engine 0053 does. */
export const migration: PostgresMigration = { name: "0053_bridges", sql };
