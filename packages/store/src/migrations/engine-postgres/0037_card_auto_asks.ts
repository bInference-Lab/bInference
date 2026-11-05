import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE cards ADD COLUMN auto_ask text COLLATE "C";
`;

/** Adds `cards.auto_ask`, as engine 0037 does. */
export const migration: PostgresMigration = { name: "0037_card_auto_asks", sql };
