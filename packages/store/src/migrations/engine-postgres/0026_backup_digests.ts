import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
ALTER TABLE backups ADD COLUMN file_sha256 text COLLATE "C" CHECK (
  file_sha256 IS NULL OR (length(file_sha256) = 64 AND file_sha256 !~ '[^0-9a-f]')
);
ALTER TABLE backups ADD COLUMN header_sha256 text COLLATE "C" CHECK (
  header_sha256 IS NULL OR (length(header_sha256) = 64 AND header_sha256 !~ '[^0-9a-f]')
);
`;

/** Adds each backup's file and header digests, as engine 0026 does. */
export const migration: PostgresMigration = { name: "0026_backup_digests", sql };
