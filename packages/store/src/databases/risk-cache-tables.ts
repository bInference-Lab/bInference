// The table of token risk reports, as SQLite returns it.

/** `risk_cache`: one source's report for one token, as JSON text. */
interface RiskCacheTable {
  asset: string;
  source: string;
  result: string;
  fetched_at: number;
}

/** The tables of the risk cache, by name. */
export interface RiskCacheTables {
  risk_cache: RiskCacheTable;
}
