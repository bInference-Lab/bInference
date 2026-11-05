import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full.
const sql = `
CREATE TABLE prices (
  asset text COLLATE "C" NOT NULL,
  source text COLLATE "C" NOT NULL CHECK (source IN ('chainlink', 'quote', 'dexscreener')),
  usd_micros numeric(78,0) NOT NULL CHECK (usd_micros >= 0),
  at bigint NOT NULL,
  PRIMARY KEY (asset, source)
);

CREATE TABLE risk_cache (
  asset text COLLATE "C" NOT NULL,
  source text COLLATE "C" NOT NULL CHECK (source IN ('goplus', 'honeypot', 'simulation')),
  result text COLLATE "C" NOT NULL CHECK (result IS JSON),
  fetched_at bigint NOT NULL,
  PRIMARY KEY (asset, source)
);
`;

/** Creates the cached prices and risk results (database spec, section 2.6), as engine 0007 does. */
export const migration: PostgresMigration = { name: "0007_market_data", sql };
