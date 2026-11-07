import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE credentials (
  name text COLLATE "C" PRIMARY KEY NOT NULL CHECK (name ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  value text COLLATE "C" NOT NULL CHECK (length(value) BETWEEN 1 AND 65536),
  allowed_hosts text COLLATE "C" NOT NULL CHECK (jsonb_typeof(allowed_hosts::jsonb) = 'array'),
  updated_at bigint NOT NULL CHECK (updated_at >= 0),
  deleted_at bigint CHECK (deleted_at IS NULL OR deleted_at >= 0)
);
`;

/** Makes `credentials`, the owner's stored credentials, as engine 0063 does. */
export const migration: PostgresMigration = { name: "0063_credentials", sql };
