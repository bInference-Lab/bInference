// The access tables of `engine.sqlite`, as SQLite returns them: migration 0009 defines them.

/** `tokens`. */
export interface TokensTable {
  id: string;
  label: string;
  kind: string;
  scopes: string;
  secret_hash: string;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

/** `devices`. */
export interface DevicesTable {
  id: string;
  label: string;
  alg: string;
  public_key: string;
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
}

/** `pair_codes`. */
interface PairCodesTable {
  code_hash: string;
  expires_at: number;
  used_at: number | null;
}

/** The access tables, by name. */
export interface AccessTables {
  tokens: TokensTable;
  devices: DevicesTable;
  pair_codes: PairCodesTable;
}
