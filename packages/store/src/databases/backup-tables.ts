/** `backups`: each backup file the install wrote, as SQLite returns it. */
interface BackupsTable {
  id: string;
  path: string;
  bytes: number;
  kind: string;
  created_at: number;
  verified_at: number | null;
  /** The SHA-256 of the file and of its header line, in hex (migration 0026). */
  file_sha256: string | null;
  header_sha256: string | null;
}

/** The backup tables the store adapters query, by name. */
export interface BackupTables {
  backups: BackupsTable;
}
