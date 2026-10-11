import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. One row per intent at
// most; the transaction column has no foreign key, as `notices.intent_id` has none: the row only
// names the transaction the engine found in a block.
const sql = `
CREATE TABLE late_landings (
  intent_id TEXT PRIMARY KEY NOT NULL REFERENCES intents (id),
  tx_id TEXT NOT NULL,
  at INTEGER NOT NULL
) STRICT;
`;

/**
 * Creates `late_landings`: a step the drop rule ended that landed after all, linked to its intent,
 * which stays as it ended (decision 0147). The rolling 24-hour cap counts such an intent again.
 */
export const migration: Migration = {
  name: "0020_late_landings",
  up(database) {
    database.exec(sql);
  },
};
