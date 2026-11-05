import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE intents ADD COLUMN draft_ref text COLLATE "C"
  CHECK (draft_ref IS NULL OR length(draft_ref) = 16);
CREATE UNIQUE INDEX intents_draft_ref ON intents (draft_ref) WHERE draft_ref IS NOT NULL;
`;

/** Adds `intents.draft_ref`, unique where set, as engine 0049 does. */
export const migration: PostgresMigration = { name: "0049_intent_draft_refs", sql };
