import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Each digest is the
// SHA-256 in lowercase hex, or NULL for a backup written before the install kept them.
const hex = (column: string): string =>
  `ALTER TABLE backups ADD COLUMN ${column} TEXT CHECK (
  ${column} IS NULL OR (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')
);`;

const sql = `
${hex("file_sha256")}
${hex("header_sha256")}
`;

/**
 * Adds `backups.file_sha256` and `backups.header_sha256`: the digests of each backup file the
 * install wrote and of its header line, by which a restore knows a file as one of its own (keys
 * spec, section 7.4).
 */
export const migration: Migration = {
  name: "0026_backup_digests",
  up(database) {
    database.exec(sql);
  },
};
