import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An owner paired before
// picked no agent: the chat talks to the only one, or asks for a pick. The chat reads a pick that
// names no agent it knows as none, so the column holds no reference.
const sql = `
ALTER TABLE telegram_owner ADD COLUMN agent_id TEXT;
`;

/** Adds `telegram_owner.agent_id`: the agent `/use` picked for the owner's chat (decision 0204). */
export const migration: Migration = {
  name: "0036_owner_agent",
  up(database) {
    database.exec(sql);
  },
};
