import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Both columns are empty for
// every row but a copy order's, so SQLite adds them in place.
const sql = `
ALTER TABLE order_fills ADD COLUMN copy_trade INTEGER CHECK (copy_trade IS NULL OR copy_trade > 0);
ALTER TABLE order_fills ADD COLUMN copy_take INTEGER CHECK (copy_take IS NULL OR copy_take > 0);
`;

/**
 * Adds to `order_fills` the leader trade a copy order's row copied and the take it ran under
 * (decision 0260): the copy order finds a take a stop cut off by its row, never by a clock.
 */
export const migration: Migration = {
  name: "0045_copy_fill_links",
  up(database) {
    database.exec(sql);
  },
};
