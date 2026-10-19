import type { Migration } from "../migration.js";

// A released migration never changes, so it writes its SQL out in full. Amounts and blocks are
// decimal text. The trades of a wallet are kept once per account, transaction and log index, so a
// block read twice stores nothing twice. The accounts of the active wallet alerts of agents not
// archived are tracked from the migration on; no copy order existed before it.
const digits = (column: string): string =>
  `${column} != '' AND ${column} NOT GLOB '*[^0-9]*' ` +
  `AND (${column} = '0' OR ${column} NOT GLOB '0*') AND length(${column}) <= 78`;
const amount = (column: string): string => `${column} TEXT NOT NULL CHECK (${digits(column)})`;
const block = (column: string): string =>
  `${column} TEXT CHECK (${column} IS NULL OR (${digits(column)}))`;

const sql = `
CREATE TABLE tracked_wallets (
  account TEXT PRIMARY KEY NOT NULL,
  ${block("since_block")},
  ${block("last_block")},
  overflow_blocks INTEGER NOT NULL DEFAULT 0 CHECK (overflow_blocks >= 0),
  added_at INTEGER NOT NULL,
  untracked_at INTEGER
) STRICT;

CREATE TABLE wallet_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  ${amount("block")},
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL CHECK (log_index >= 0),
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  asset TEXT NOT NULL,
  ${amount("amount")},
  counter_asset TEXT NOT NULL,
  ${amount("counter_amount")},
  value_usd_micros TEXT CHECK (value_usd_micros IS NULL OR (${digits("value_usd_micros")})),
  share_sold_bps INTEGER CHECK (share_sold_bps IS NULL OR share_sold_bps BETWEEN 0 AND 10000),
  venue TEXT,
  at INTEGER NOT NULL
) STRICT;

CREATE UNIQUE INDEX wallet_activity_key ON wallet_activity (account, tx_hash, log_index);
CREATE INDEX wallet_activity_account_at ON wallet_activity (account, at);

CREATE TABLE watch_cursors (
  watcher TEXT NOT NULL CHECK (watcher IN ('launches', 'wallets')),
  chain TEXT NOT NULL,
  ${amount("block")},
  block_hash TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (watcher, chain)
) STRICT;

INSERT INTO tracked_wallets (account, added_at)
SELECT alerts.account, min(alerts.created_at)
FROM alerts JOIN agents ON agents.id = alerts.agent_id
WHERE alerts.state = 'active' AND alerts.account IS NOT NULL AND agents.archived_at IS NULL
GROUP BY alerts.account;
`;

/**
 * Creates `tracked_wallets`, `wallet_activity` and `watch_cursors` (database spec, section 2.6;
 * decision 0251), and tracks the account of every active wallet alert of an agent not archived.
 */
export const migration: Migration = {
  name: "0042_tracked_wallets",
  up(database) {
    database.exec(sql);
  },
};
