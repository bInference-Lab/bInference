import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A token stored before has
// no expiry and works until it is revoked.
const sql = `
ALTER TABLE tokens ADD COLUMN expires_at INTEGER CHECK (
  expires_at IS NULL OR expires_at > created_at
);
`;

/**
 * Adds `tokens.expires_at`: when a client token stops signing in, or none for a token that works
 * until it is revoked (decision 0159).
 */
export const migration: Migration = {
  name: "0022_token_expiry",
  up(database) {
    database.exec(sql);
  },
};
