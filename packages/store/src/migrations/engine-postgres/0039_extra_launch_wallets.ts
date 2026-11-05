import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
DROP INDEX wallets_one_launch_per_agent;
`;

/** Lets one agent hold more than one live launch wallet, as engine 0039 does. */
export const migration: PostgresMigration = { name: "0039_extra_launch_wallets", sql };
