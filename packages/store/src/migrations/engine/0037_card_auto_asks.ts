import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A card version stored
// before shows no auto mode line: its card was drawn without one.
const sql = `
ALTER TABLE cards ADD COLUMN auto_ask TEXT;
`;

/**
 * Adds `cards.auto_ask`: why auto mode opened the card version instead of filling its intent, the
 * code of the auto test its card names (spec 4, section 3.4); none when the agent was in manual
 * mode.
 */
export const migration: Migration = {
  name: "0037_card_auto_asks",
  up(database) {
    database.exec(sql);
  },
};
