// The table of the owner's credentials, as SQLite returns it: migration 0063 defines it.

/** `credentials`: one credential by name, its hosts as JSON text. */
interface CredentialTable {
  name: string;
  value: string;
  allowed_hosts: string;
  updated_at: number;
  deleted_at: number | null;
}

/** The tables of the owner's credentials, by name. */
export interface CredentialTables {
  credentials: CredentialTable;
}
