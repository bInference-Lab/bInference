import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE safety ADD COLUMN rescue_ceiling TEXT
  CHECK (rescue_ceiling IS NULL OR json_valid(rescue_ceiling));
`;

/**
 * Adds `safety.rescue_ceiling`: the ceiling changes the owner key signed ahead for a new rescue
 * address that waits, as JSON (decision 0110).
 */
export const migration: Migration = {
  name: "0012_rescue_ceiling",
  up(database) {
    database.exec(sql);
  },
};
