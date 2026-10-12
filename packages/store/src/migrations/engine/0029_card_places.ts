import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A card version stored
// before shows no place: it was a swap's, or a buy's or a sell's before places were kept.
const sql = `
ALTER TABLE cards ADD COLUMN place TEXT CHECK (place IS NULL OR json_valid(place));
`;

/**
 * Adds `cards.place`: where the `buy` or `sell` a card version shows trades, as JSON (spec 6,
 * section 5), so the next version can say its place changed.
 */
export const migration: Migration = {
  name: "0029_card_places",
  up(database) {
    database.exec(sql);
  },
};
