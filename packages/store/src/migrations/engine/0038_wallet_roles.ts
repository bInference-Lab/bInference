import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Every wallet stored before
// is an agent wallet. One agent holds at most one live launch wallet.
const sql = `
ALTER TABLE wallets ADD COLUMN role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('agent', 'launch'));
CREATE UNIQUE INDEX wallets_one_launch_per_agent ON wallets (agent_id)
  WHERE role = 'launch' AND archived_at IS NULL;
`;

/**
 * Adds `wallets.role`: `agent`, or `launch` for an agent's launch wallet, whose ceiling allows the
 * calls launchpads declare on each launch's own contracts (decision 0217), with at most one live
 * launch wallet per agent.
 */
export const migration: Migration = {
  name: "0038_wallet_roles",
  up(database) {
    database.exec(sql);
  },
};
