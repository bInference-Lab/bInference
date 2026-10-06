import type { Migration } from "../migration.js";

const sql = `
CREATE TABLE prices (
  asset TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('chainlink', 'quote', 'dexscreener')),
  usd_micros TEXT NOT NULL CHECK (
    usd_micros != '' AND usd_micros NOT GLOB '*[^0-9]*'
    AND (usd_micros = '0' OR usd_micros NOT GLOB '0*') AND length(usd_micros) <= 78
  ),
  at INTEGER NOT NULL,
  PRIMARY KEY (asset, source)
) STRICT;

CREATE TABLE risk_cache (
  asset TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('goplus', 'honeypot', 'simulation')),
  result TEXT NOT NULL CHECK (json_valid(result)),
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (asset, source)
) STRICT;
`;

/** Creates the market data caches (database spec, section 2.6): `prices` and `risk_cache`. */
export const migration: Migration = {
  name: "0007_market_data",
  up(database) {
    database.exec(sql);
  },
};
