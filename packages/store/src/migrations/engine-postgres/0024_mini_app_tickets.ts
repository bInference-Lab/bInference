import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE mini_app_tickets (
  ticket_hash text COLLATE "C" PRIMARY KEY NOT NULL CHECK (
    length(ticket_hash) = 64 AND ticket_hash !~ '[^0-9a-f]'
  ),
  user_id bigint NOT NULL CHECK (user_id > 0),
  issued_at bigint NOT NULL,
  expires_at bigint NOT NULL CHECK (expires_at > issued_at)
);

CREATE INDEX mini_app_tickets_issued_at ON mini_app_tickets (issued_at);
`;

/** Creates `mini_app_tickets`, the hash of each upload ticket, as engine 0024 does. */
export const migration: PostgresMigration = { name: "0024_mini_app_tickets", sql };
