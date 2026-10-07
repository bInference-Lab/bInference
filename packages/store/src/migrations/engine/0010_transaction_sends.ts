import type { Migration } from "../migration.js";

// The relay answers and refusal reasons of `@binference/chain`, copied: a released migration never
// changes, so it keeps its own lists.
const outcomes = "'accepted', 'refused', 'timed_out', 'unreachable'";
const reasons = [
  "'nonce_too_low'",
  "'underpriced'",
  "'replacement_underpriced'",
  "'insufficient_funds'",
  "'gas_quota'",
  "'malformed_transaction'",
  "'rate_limited'",
  "'bad_answer'",
  "'rejected'",
].join(", ");

const sends = `
CREATE TABLE tx_sends (
  tx_id TEXT NOT NULL REFERENCES txs (id),
  attempt INTEGER NOT NULL CHECK (attempt >= 0),
  place INTEGER NOT NULL CHECK (place >= 0),
  relay TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN (${outcomes})),
  reason TEXT CHECK (reason IS NULL OR reason IN (${reasons})),
  code INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (tx_id, attempt, place),
  UNIQUE (tx_id, attempt, relay),
  CHECK ((outcome = 'refused') = (reason IS NOT NULL)),
  CHECK (outcome = 'refused' OR code IS NULL)
) STRICT;
`;

/**
 * Creates `tx_sends`: each private relay's answer to each send of a signed transaction, one row
 * per relay per send, in the relays' order. `txs.relays` keeps the relays a transaction goes to.
 */
export const migration: Migration = {
  name: "0010_transaction_sends",
  up(database) {
    database.exec(sends);
  },
};
