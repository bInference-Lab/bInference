import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite adds no column
// under a check in place, so the table is made again with it and filled from the old one, in the
// migration's one transaction; no table refers to it. Every entry saved before holds an address of
// a chain the registry served then, all EVM chains, whose recipient bytes are the address's hex in
// lowercase.
const sql = `
CREATE TABLE address_book_bytes (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  usable_at INTEGER NOT NULL,
  in_ceiling_at INTEGER,
  created_at INTEGER NOT NULL,
  removed_at INTEGER,
  recipient_bytes TEXT NOT NULL CHECK (
    recipient_bytes GLOB '0x?*'
    AND substr(recipient_bytes, 3) NOT GLOB '*[^0-9a-f]*'
    AND length(recipient_bytes) % 2 = 0
  )
) STRICT;

INSERT INTO address_book_bytes
  SELECT id, agent_id, chain, address, label, usable_at, in_ceiling_at, created_at, removed_at,
    lower(address)
  FROM address_book;

DROP TABLE address_book;
ALTER TABLE address_book_bytes RENAME TO address_book;

CREATE UNIQUE INDEX address_book_saved ON address_book (agent_id, chain, address)
  WHERE removed_at IS NULL;
`;

/**
 * Keeps each address book entry's recipient bytes (decisions 0297 and 0298): the 20 or 32 bytes,
 * in lowercase hex after `0x`, that its family's address codec gives the address, which a bridge's
 * recipient check reads back. The column takes nothing else, so no writer can leave an entry the
 * store cannot read. Every stored entry keeps its address and gains its bytes.
 */
export const migration: Migration = {
  name: "0052_address_recipient_bytes",
  up(database) {
    database.exec(sql);
  },
};
