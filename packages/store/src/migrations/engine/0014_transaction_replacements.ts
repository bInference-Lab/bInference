import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE txs ADD COLUMN replacement TEXT CHECK (
  (replacement IS NULL) = (supersedes IS NULL)
  AND (replacement IS NULL OR replacement IN ('speedUp', 'cancel'))
);
`;

/**
 * Adds `txs.replacement`: how a stuck step's replacement takes the nonce of the transaction
 * `supersedes` names, a `speedUp` of the same call or a `cancel` (intent-states spec, section 6).
 */
export const migration: Migration = {
  name: "0014_transaction_replacements",
  up(database) {
    database.exec(sql);
  },
};
