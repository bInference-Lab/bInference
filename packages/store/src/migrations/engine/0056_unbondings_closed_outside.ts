import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE stake_unbondings ADD COLUMN closed_outside_at INTEGER;
`;

/**
 * Adds `stake_unbondings.closed_outside_at` (decision 0331): when an unbonding closed because its
 * venue no longer lists its request, claimed outside binference, such as by the venue's own bot or
 * on its site. A closed row is no longer open, and no claim of binference takes it.
 */
export const migration: Migration = {
  name: "0056_unbondings_closed_outside",
  up(database) {
    database.exec(sql);
  },
};
