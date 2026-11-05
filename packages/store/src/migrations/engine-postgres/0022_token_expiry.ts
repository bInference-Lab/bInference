import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE tokens ADD COLUMN expires_at bigint CHECK (
  expires_at IS NULL OR expires_at > created_at
);
`;

/** Adds `tokens.expires_at`, as engine 0022 does. */
export const migration: PostgresMigration = { name: "0022_token_expiry", sql };
