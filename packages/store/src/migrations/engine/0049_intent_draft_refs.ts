import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. An intent stored before
// names no launch draft: no draft's Start proposed one through this column.
const sql = `
ALTER TABLE intents ADD COLUMN draft_ref TEXT CHECK (draft_ref IS NULL OR length(draft_ref) = 16);
CREATE UNIQUE INDEX intents_draft_ref ON intents (draft_ref) WHERE draft_ref IS NOT NULL;
`;

/**
 * Adds `intents.draft_ref`: the reference of the launch draft whose Start proposed the intent, one
 * intent per reference, so a press of a draft the engine no longer holds finds the launch it
 * started (decision 0288).
 */
export const migration: Migration = {
  name: "0049_intent_draft_refs",
  up(database) {
    database.exec(sql);
  },
};
