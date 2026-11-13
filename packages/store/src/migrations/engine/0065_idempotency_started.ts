import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot drop a
// column's NOT NULL in place, so `idempotency` is made again: the new table first, its rows
// copied, the old one dropped, then renamed, all in the migration's one transaction.
const sql = `
CREATE TABLE idempotency_new (
  credential TEXT NOT NULL,
  op TEXT NOT NULL,
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 64),
  args_hash TEXT NOT NULL CHECK (length(args_hash) = 64 AND args_hash NOT GLOB '*[^0-9a-f]*'),
  result TEXT CHECK (json_valid(result)),
  at INTEGER NOT NULL,
  PRIMARY KEY (credential, op, key)
) STRICT;

INSERT INTO idempotency_new (credential, op, key, args_hash, result, at)
SELECT credential, op, key, args_hash, result, at FROM idempotency;

DROP TABLE idempotency;
ALTER TABLE idempotency_new RENAME TO idempotency;
`;

/**
 * Lets a key's `result` be empty (decision 0437): a write marks its key started, with no result,
 * before it runs, and fills the result once it answered, so a key whose engine stopped while its
 * write ran stays marked and its write never runs a second time.
 */
export const migration: Migration = {
  name: "0065_idempotency_started",
  up(database) {
    database.exec(sql);
  },
};
