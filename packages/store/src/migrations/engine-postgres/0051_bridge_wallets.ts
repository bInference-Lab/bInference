import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. The role column is made
// again under its new check, as on SQLite, so it keeps its place, last.
const sql = `
ALTER TABLE wallets RENAME COLUMN role TO role_before;
ALTER TABLE wallets ADD COLUMN role text COLLATE "C" NOT NULL DEFAULT 'agent'
  CHECK (role IN ('agent', 'launch', 'bridge'));
UPDATE wallets SET role = role_before;
ALTER TABLE wallets DROP COLUMN role_before;
`;

/** Lets `wallets.role` name a bridge wallet, as engine 0051 does. */
export const migration: PostgresMigration = { name: "0051_bridge_wallets", sql };
