import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE telegram_owner ADD COLUMN agent_id text COLLATE "C";
`;

/** Adds `telegram_owner.agent_id`, the agent the owner's chat talks to, as engine 0036 does. */
export const migration: PostgresMigration = { name: "0036_owner_agent", sql };
