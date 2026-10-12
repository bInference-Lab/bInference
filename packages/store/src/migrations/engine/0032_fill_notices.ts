import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A row written before has
// no notices to announce, so both columns start empty.
const sql = `
ALTER TABLE order_fills ADD COLUMN notices TEXT CHECK (json_valid(notices));
ALTER TABLE order_fills ADD COLUMN announced_at INTEGER;

CREATE INDEX order_fills_unannounced ON order_fills (at)
  WHERE notices IS NOT NULL AND announced_at IS NULL;
`;

/**
 * Adds to `order_fills` the notices of each fill or skip, written in the transaction that ends its
 * intent, and when they were announced, so a stop between the two loses no notice (decision 0197).
 */
export const migration: Migration = {
  name: "0032_fill_notices",
  up(database) {
    database.exec(sql);
  },
};
