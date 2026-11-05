import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE txs ADD COLUMN replacement text COLLATE "C" CHECK (
  (replacement IS NULL) = (supersedes IS NULL)
  AND (replacement IS NULL OR replacement IN ('speedUp', 'cancel'))
);
`;

/**
 * Adds `txs.replacement`, a speed-up or a cancel of the transaction it supersedes, as engine 0014
 * does.
 */
export const migration: PostgresMigration = { name: "0014_transaction_replacements", sql };
