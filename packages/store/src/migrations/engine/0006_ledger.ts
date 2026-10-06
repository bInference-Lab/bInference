import type { Migration } from "../migration.js";

// SQLite enforces the chain itself: an insert must take the next seq and link to the last hash,
// and no row ever changes or goes.
const sql = `
CREATE TABLE ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  at INTEGER NOT NULL,
  agent_id TEXT REFERENCES agents (id),
  kind TEXT NOT NULL,
  subject TEXT,
  data TEXT NOT NULL CHECK (json_valid(data)),
  prev_hash TEXT NOT NULL CHECK (length(prev_hash) = 64 AND prev_hash NOT GLOB '*[^0-9a-f]*'),
  hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64 AND hash NOT GLOB '*[^0-9a-f]*')
) STRICT;

CREATE TRIGGER ledger_appends_to_chain BEFORE INSERT ON ledger
WHEN NEW.seq IS NOT (SELECT coalesce(max(seq), 0) + 1 FROM ledger)
  OR NEW.prev_hash IS NOT coalesce(
    (SELECT hash FROM ledger ORDER BY seq DESC LIMIT 1),
    '0000000000000000000000000000000000000000000000000000000000000000'
  )
BEGIN
  SELECT RAISE(ABORT, 'a ledger entry takes the next seq and the last entry''s hash');
END;

CREATE TRIGGER ledger_refuses_changes BEFORE UPDATE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append-only');
END;

CREATE TRIGGER ledger_refuses_removal BEFORE DELETE ON ledger
BEGIN
  SELECT RAISE(ABORT, 'the ledger is append-only');
END;
`;

/**
 * Creates the append-only, hash-chained `ledger` (database spec, section 2.5), with triggers that
 * refuse an entry off the chain, any change and any removal.
 */
export const migration: Migration = {
  name: "0006_ledger",
  up(database) {
    database.exec(sql);
  },
};
