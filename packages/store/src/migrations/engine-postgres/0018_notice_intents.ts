import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE notices ADD COLUMN intent_id text COLLATE "C";
`;

/** Adds `notices.intent_id`, with no foreign key, as engine 0018 does. */
export const migration: PostgresMigration = { name: "0018_notice_intents", sql };
