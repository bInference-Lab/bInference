import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE cards ADD COLUMN place text COLLATE "C" CHECK (place IS NULL OR place IS JSON);
`;

/** Adds `cards.place`, as engine 0029 does. */
export const migration: PostgresMigration = { name: "0029_card_places", sql };
