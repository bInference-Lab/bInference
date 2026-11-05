import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE wallets ADD COLUMN role text COLLATE "C" NOT NULL DEFAULT 'agent'
  CHECK (role IN ('agent', 'launch'));
CREATE UNIQUE INDEX wallets_one_launch_per_agent ON wallets (agent_id)
  WHERE role = 'launch' AND archived_at IS NULL;
`;

/** Adds `wallets.role`, an agent wallet or a launch wallet, as engine 0038 does. */
export const migration: PostgresMigration = { name: "0038_wallet_roles", sql };
