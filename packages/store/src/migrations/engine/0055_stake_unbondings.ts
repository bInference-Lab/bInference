import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An amount is a decimal
// string of base units, at most 78 digits, with no sign and no leading zero; a request's id is the
// venue's own, such as a credit contract and a sequence number.
const sql = `
CREATE TABLE stake_unbondings (
  id INTEGER PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES intents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  venue TEXT NOT NULL CHECK (length(venue) BETWEEN 1 AND 200),
  validator TEXT,
  request_ref TEXT NOT NULL CHECK (length(request_ref) BETWEEN 1 AND 200),
  asset TEXT NOT NULL,
  amount TEXT NOT NULL CHECK (amount != '' AND amount NOT GLOB '*[^0-9]*' AND (amount = '0' OR amount NOT GLOB '0*') AND length(amount) <= 78),
  value_usd_micros TEXT CHECK (value_usd_micros IS NULL OR (value_usd_micros != '' AND value_usd_micros NOT GLOB '*[^0-9]*' AND (value_usd_micros = '0' OR value_usd_micros NOT GLOB '0*') AND length(value_usd_micros) <= 78)),
  ready_at INTEGER NOT NULL,
  claim_intent_id TEXT REFERENCES intents (id),
  claimed_at INTEGER,
  told_ready_at INTEGER,
  paper INTEGER NOT NULL CHECK (paper IN (0, 1)),
  CHECK ((claim_intent_id IS NULL) = (claimed_at IS NULL))
) STRICT;

CREATE UNIQUE INDEX stake_unbondings_request ON stake_unbondings (venue, wallet_id, paper, request_ref);
CREATE INDEX stake_unbondings_open ON stake_unbondings (wallet_id, paper, venue, ready_at) WHERE claim_intent_id IS NULL;
CREATE INDEX stake_unbondings_claim ON stake_unbondings (claim_intent_id) WHERE claim_intent_id IS NOT NULL;
CREATE INDEX stake_unbondings_untold ON stake_unbondings (ready_at) WHERE claim_intent_id IS NULL AND told_ready_at IS NULL;
`;

/**
 * Creates `stake_unbondings` (decision 0296): one row per unstake, opened when it reconciles or
 * fills on paper, with the venue's own id of its request, the coin it took out and what the
 * unstake recorded it worth, and when a claim can take it, then when the owner was told it is
 * ready and the claim that took it. One request of a venue's wallet in one mode is held once.
 */
export const migration: Migration = {
  name: "0055_stake_unbondings",
  up(database) {
    database.exec(sql);
  },
};
