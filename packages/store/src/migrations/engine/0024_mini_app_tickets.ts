import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. A row holds the SHA-256 of
// a ticket, never the ticket; a new ticket deletes the expired rows and the oldest past 16.
const sql = `
CREATE TABLE mini_app_tickets (
  ticket_hash TEXT PRIMARY KEY NOT NULL CHECK (
    length(ticket_hash) = 64 AND ticket_hash NOT GLOB '*[^0-9a-f]*'
  ),
  user_id INTEGER NOT NULL CHECK (user_id > 0),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at)
) STRICT;

CREATE INDEX mini_app_tickets_issued_at ON mini_app_tickets (issued_at);
`;

/**
 * Creates `mini_app_tickets`: the single-use tickets `/console` puts in the Mini App's address, so
 * only a launch from that button signs in (decision 0161).
 */
export const migration: Migration = {
  name: "0024_mini_app_tickets",
  up(database) {
    database.exec(sql);
  },
};
