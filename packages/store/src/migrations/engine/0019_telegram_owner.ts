import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. The row appears when the
// owner first pairs, and a new pairing replaces it.
const sql = `
CREATE TABLE telegram_owner (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  user_id INTEGER NOT NULL CHECK (user_id > 0),
  paired_at INTEGER NOT NULL
) STRICT;
`;

/**
 * Creates `telegram_owner`: one row, the owner's numeric Telegram id and when a start code paired
 * it, so the owner's bot stays paired across restarts (decision 0139).
 */
export const migration: Migration = {
  name: "0019_telegram_owner",
  up(database) {
    database.exec(sql);
  },
};
