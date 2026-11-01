import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An amount is a decimal
// string of base units, at most 78 digits, with no sign and no leading zero; a transaction hash
// fits the id grammar every family's hashes fit.
const sql = `
CREATE TABLE bridges (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES intents (id),
  venue TEXT NOT NULL CHECK (length(venue) BETWEEN 1 AND 200),
  deposit_ref TEXT NOT NULL CHECK (length(deposit_ref) BETWEEN 1 AND 128 AND deposit_ref NOT GLOB '*[^-.%a-zA-Z0-9]*'),
  to_chain TEXT NOT NULL,
  recipient TEXT NOT NULL,
  sent_asset TEXT NOT NULL,
  sent_amount TEXT NOT NULL CHECK (sent_amount != '' AND sent_amount NOT GLOB '*[^0-9]*' AND (sent_amount = '0' OR sent_amount NOT GLOB '0*') AND length(sent_amount) <= 78),
  delivered_asset TEXT NOT NULL,
  delivered_coin TEXT,
  min_out TEXT NOT NULL CHECK (min_out != '' AND min_out NOT GLOB '*[^0-9]*' AND (min_out = '0' OR min_out NOT GLOB '0*') AND length(min_out) <= 78),
  value_usd_micros TEXT CHECK (value_usd_micros IS NULL OR (value_usd_micros != '' AND value_usd_micros NOT GLOB '*[^0-9]*' AND (value_usd_micros = '0' OR value_usd_micros NOT GLOB '0*') AND length(value_usd_micros) <= 78)),
  state TEXT NOT NULL CHECK (state IN ('in_transit', 'late', 'delivered', 'refunded')),
  status_url TEXT CHECK (status_url IS NULL OR length(status_url) BETWEEN 1 AND 2000),
  sent_at INTEGER NOT NULL,
  late_at INTEGER,
  fill_tx TEXT CHECK (fill_tx IS NULL OR (length(fill_tx) BETWEEN 1 AND 128 AND fill_tx NOT GLOB '*[^-.%a-zA-Z0-9]*')),
  received TEXT CHECK (received IS NULL OR (received != '' AND received NOT GLOB '*[^0-9]*' AND (received = '0' OR received NOT GLOB '0*') AND length(received) <= 78)),
  received_asset TEXT,
  refund_tx TEXT CHECK (refund_tx IS NULL OR (length(refund_tx) BETWEEN 1 AND 128 AND refund_tx NOT GLOB '*[^-.%a-zA-Z0-9]*')),
  settled_at INTEGER,
  checked_at INTEGER,
  version INTEGER NOT NULL CHECK (version >= 0),
  CHECK ((received IS NULL) = (received_asset IS NULL))
) STRICT;

CREATE INDEX bridges_state ON bridges (state, sent_at);
CREATE UNIQUE INDEX bridges_fill ON bridges (to_chain, fill_tx) WHERE fill_tx IS NOT NULL;
CREATE UNIQUE INDEX bridges_refund ON bridges (refund_tx) WHERE refund_tx IS NOT NULL;
`;

/**
 * Creates `bridges` (decision 0297): one row per bridge intent, opened when its deposit is final,
 * with where its delivery stands, the recipient and the token it reads the delivery in, and what a
 * read found, the fill or the refund, so a delivery is followed across a restart. One fill per
 * destination chain, and one refund, settles one bridge at most.
 */
export const migration: Migration = {
  name: "0053_bridges",
  up(database) {
    database.exec(sql);
  },
};
