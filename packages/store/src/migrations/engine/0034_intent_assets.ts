import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An intent stored before
// names no unlisted token's facts: its cards show the registry's tokens only, as they did.
const sql = `
ALTER TABLE intents ADD COLUMN assets TEXT CHECK (assets IS NULL OR json_valid(assets));
`;

/**
 * Adds `intents.assets`: what each token an intent names and the registry does not list answered
 * on chain at its proposal, its symbol, name and decimals as JSON, which its cards show
 * (decision 0199).
 */
export const migration: Migration = {
  name: "0034_intent_assets",
  up(database) {
    database.exec(sql);
  },
};
