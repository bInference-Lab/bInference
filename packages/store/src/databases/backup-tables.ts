/** `backups`: each backup file the install wrote, as SQLite returns it. */
interface BackupsTable {
  id: string;
  path: string;
  bytes: number;
  kind: string;
  created_at: number;
  verified_at: number | null;
}

/** The backup tables the store adapters query, by name. */
export interface BackupTables {
  backups: BackupsTable;
}
