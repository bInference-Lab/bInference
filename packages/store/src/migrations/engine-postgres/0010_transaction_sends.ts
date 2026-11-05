import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE tx_sends (
  tx_id text COLLATE "C" NOT NULL REFERENCES txs (id),
  attempt bigint NOT NULL CHECK (attempt >= 0),
  place bigint NOT NULL CHECK (place >= 0),
  relay text COLLATE "C" NOT NULL,
  outcome text COLLATE "C" NOT NULL
    CHECK (outcome IN ('accepted', 'refused', 'timed_out', 'unreachable')),
  reason text COLLATE "C" CHECK (reason IS NULL OR reason IN (
    'nonce_too_low', 'underpriced', 'replacement_underpriced', 'insufficient_funds', 'gas_quota',
    'malformed_transaction', 'rate_limited', 'bad_answer', 'rejected'
  )),
  code bigint,
  at bigint NOT NULL,
  PRIMARY KEY (tx_id, attempt, place),
  UNIQUE (tx_id, attempt, relay),
  CHECK ((outcome = 'refused') = (reason IS NOT NULL)),
  CHECK (outcome = 'refused' OR code IS NULL)
);
`;

/** Creates `tx_sends`, each relay's answer to each send of a transaction, as engine 0010 does. */
export const migration: PostgresMigration = { name: "0010_transaction_sends", sql };
