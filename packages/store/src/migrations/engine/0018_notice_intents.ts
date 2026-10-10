import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The column has no foreign
// key: a notice must never fail to be stored for the intent it names, and intents are kept forever.
const sql = `
ALTER TABLE notices ADD COLUMN intent_id TEXT;
`;

/**
 * Adds `notices.intent_id`: the intent a notice is about, such as a trade that stopped part way,
 * which `notice/list` gives back as the push gave it (decision 0133).
 */
export const migration: Migration = {
  name: "0018_notice_intents",
  up(database) {
    database.exec(sql);
  },
};
