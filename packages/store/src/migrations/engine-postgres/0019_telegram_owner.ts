import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE telegram_owner (
  id bigint PRIMARY KEY NOT NULL CHECK (id = 1),
  user_id bigint NOT NULL CHECK (user_id > 0),
  paired_at bigint NOT NULL
);
`;

/** Creates `telegram_owner`, the paired owner's one row, as engine 0019 does. */
export const migration: PostgresMigration = { name: "0019_telegram_owner", sql };
