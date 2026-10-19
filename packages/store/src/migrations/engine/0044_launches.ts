import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Blocks are decimal text;
// the index on a launch's block serves the delete of the launches a reorganization removed from a
// read's blocks. A launch's insiders are a JSON array of account ids.
const digits = (column: string): string =>
  `${column} != '' AND ${column} NOT GLOB '*[^0-9]*' ` +
  `AND (${column} = '0' OR ${column} NOT GLOB '0*') AND length(${column}) <= 78`;
const bps = (column: string): string =>
  `${column} INTEGER CHECK (${column} IS NULL OR ${column} BETWEEN 0 AND 10000)`;

const sql = `
CREATE TABLE launches (
  chain TEXT NOT NULL,
  token TEXT NOT NULL,
  launchpad TEXT NOT NULL,
  creator TEXT NOT NULL,
  quote_token TEXT NOT NULL,
  symbol TEXT,
  name TEXT,
  decimals INTEGER CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 255),
  ${bps("tax_bps")},
  ${bps("snipe_tax_bps")},
  ${bps("curve_progress_bps")},
  graduated INTEGER NOT NULL CHECK (graduated IN (0, 1)),
  insiders TEXT NOT NULL CHECK (json_valid(insiders) AND json_type(insiders) = 'array'),
  block TEXT NOT NULL CHECK (${digits("block")}),
  block_hash TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  launched_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  PRIMARY KEY (chain, token)
) STRICT;

CREATE INDEX launches_chain_launched_at ON launches (chain, launched_at);
CREATE INDEX launches_creator_launched_at ON launches (creator, launched_at);
CREATE INDEX launches_chain_block ON launches (chain, block);
`;

/**
 * Creates `launches` (database spec, section 2.6; decision 0255): one row per token a launchpad
 * created, with its token's words and decimals as the feed read them.
 */
export const migration: Migration = {
  name: "0044_launches",
  up(database) {
    database.exec(sql);
  },
};
