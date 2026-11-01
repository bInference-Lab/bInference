import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN rescue_reach TEXT
  CHECK (rescue_reach IS NULL OR (json_valid(rescue_reach) AND json_type(rescue_reach) = 'array'));
`;

/**
 * Adds `safety.rescue_reach`: where each rescue address stands in each agent's bridge rules on each
 * destination chain, as a JSON array (decision 0321).
 */
export const migration: Migration = {
  name: "0054_rescue_reach",
  up(database) {
    database.exec(sql);
  },
};
