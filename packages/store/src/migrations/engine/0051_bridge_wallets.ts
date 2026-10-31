import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. SQLite cannot change a
// column's check in place, so the role column is made again under its new check: the old one
// renamed, the new one added and filled from it, then the old one dropped, in the migration's one
// transaction. The column keeps its place, last.
const sql = `
ALTER TABLE wallets RENAME COLUMN role TO role_before;
ALTER TABLE wallets ADD COLUMN role TEXT NOT NULL DEFAULT 'agent'
  CHECK (role IN ('agent', 'launch', 'bridge'));
UPDATE wallets SET role = role_before;
ALTER TABLE wallets DROP COLUMN role_before;
`;

/**
 * Lets `wallets.role` hold `bridge`, for an agent's bridge wallet, whose ceiling alone allows the
 * deposits a bridge venue marks as a bridge wallet's (decision 0303). Every stored role stays.
 */
export const migration: Migration = {
  name: "0051_bridge_wallets",
  up(database) {
    database.exec(sql);
  },
};
