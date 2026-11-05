import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE intents ADD COLUMN assets text COLLATE "C" CHECK (assets IS NULL OR assets IS JSON);
`;

/** Adds `intents.assets`, the facts of the unlisted tokens an intent names, as engine 0034 does. */
export const migration: PostgresMigration = { name: "0034_intent_assets", sql };
