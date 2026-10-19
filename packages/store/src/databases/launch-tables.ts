// The launch feed's table, as SQLite returns it: migration 0044 defines it.

/** `launches`: one token a launchpad created; its block as decimal text, insiders as JSON. */
interface LaunchesTable {
  chain: string;
  token: string;
  launchpad: string;
  creator: string;
  quote_token: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  tax_bps: number | null;
  snipe_tax_bps: number | null;
  curve_progress_bps: number | null;
  graduated: number;
  insiders: string;
  block: string;
  block_hash: string;
  tx_hash: string;
  log_index: number;
  launched_at: number;
  changed_at: number;
}

/** The launch feed's tables, by name. */
export interface LaunchTables {
  launches: LaunchesTable;
}
