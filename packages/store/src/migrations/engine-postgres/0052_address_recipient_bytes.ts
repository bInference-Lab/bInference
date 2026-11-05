import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Postgres adds the column
// in place, last, as SQLite's rebuild leaves it. Every entry saved before holds an EVM address,
// whose recipient bytes are its hex in lowercase.
const sql = `
ALTER TABLE address_book ADD COLUMN recipient_bytes text COLLATE "C" CHECK (
  recipient_bytes ~ '^0x.'
  AND substr(recipient_bytes, 3) !~ '[^0-9a-f]'
  AND length(recipient_bytes) % 2 = 0
);
UPDATE address_book SET recipient_bytes = lower(address);
ALTER TABLE address_book ALTER COLUMN recipient_bytes SET NOT NULL;
`;

/**
 * Adds `address_book.recipient_bytes`, filled for every entry saved before, as engine 0052 does.
 */
export const migration: PostgresMigration = { name: "0052_address_recipient_bytes", sql };
