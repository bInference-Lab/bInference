import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. Blocks are
// numeric(78,0); a launch's insiders are a JSON array of account ids.
const sql = `
CREATE TABLE launches (
  chain text COLLATE "C" NOT NULL,
  token text COLLATE "C" NOT NULL,
  launchpad text COLLATE "C" NOT NULL,
  creator text COLLATE "C" NOT NULL,
  quote_token text COLLATE "C" NOT NULL,
  symbol text COLLATE "C",
  name text COLLATE "C",
  decimals bigint CHECK (decimals IS NULL OR decimals BETWEEN 0 AND 255),
  tax_bps bigint CHECK (tax_bps IS NULL OR tax_bps BETWEEN 0 AND 10000),
  snipe_tax_bps bigint CHECK (snipe_tax_bps IS NULL OR snipe_tax_bps BETWEEN 0 AND 10000),
  curve_progress_bps bigint
    CHECK (curve_progress_bps IS NULL OR curve_progress_bps BETWEEN 0 AND 10000),
  graduated smallint NOT NULL CHECK (graduated IN (0, 1)),
  insiders text COLLATE "C" NOT NULL CHECK (insiders IS JSON ARRAY),
  block numeric(78,0) NOT NULL CHECK (block >= 0),
  block_hash text COLLATE "C" NOT NULL,
  tx_hash text COLLATE "C" NOT NULL,
  log_index bigint NOT NULL CHECK (log_index >= 0),
  launched_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  PRIMARY KEY (chain, token)
);

CREATE INDEX launches_chain_launched_at ON launches (chain, launched_at);
CREATE INDEX launches_creator_launched_at ON launches (creator, launched_at);
CREATE INDEX launches_chain_block ON launches (chain, block);
`;

/** Creates `launches`, the token launches the launch feed read, as engine 0044 does. */
export const migration: PostgresMigration = { name: "0044_launches", sql };
