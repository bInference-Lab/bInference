import type { Migration } from "../migration.js";

// Each migration keeps its own helpers: a released file never changes, and a helper it shared with
// a later migration could. An amount is a decimal string of base units with no sign and no leading
// zero; a rate is 0 to 10,000 basis points.
const amount = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (${column} != '' AND ${column} NOT GLOB '*[^0-9]*' ` +
  `AND (${column} = '0' OR ${column} NOT GLOB '0*') AND length(${column}) <= 78)`;
const rate = (column: string): string =>
  `${column} INTEGER NOT NULL CHECK (${column} BETWEEN 0 AND 10000)`;
const json = (column: string): string => `${column} TEXT NOT NULL CHECK (json_valid(${column}))`;
const positive = (column: string): string => `${column} INTEGER NOT NULL CHECK (${column} > 0)`;

const agents = `
CREATE TABLE agents (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'live')),
  frozen_at INTEGER,
  archived_at INTEGER,
  locale TEXT NOT NULL,
  ${json("models")},
  ${json("notifications")},
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE limits (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents (id),
  ${amount("per_trade_usd_micros")},
  ${amount("rolling_day_usd_micros")},
  ${rate("slippage_registry_bps")},
  ${rate("slippage_other_bps")},
  ${rate("price_impact_bps")},
  ${rate("tax_bps")},
  ${amount("liquidity_floor_usd_micros")},
  min_health_factor_bp INTEGER NOT NULL CHECK (min_health_factor_bp >= 0),
  ${json("gas_reserve")},
  ${json("venues")},
  ${json("allow_tokens")},
  ${json("deny_tokens")},
  ${amount("model_budget_usd_micros")},
  ${positive("card_trade_expiry_s")},
  ${positive("card_other_expiry_s")},
  ${positive("requote_after_s")},
  ${rate("requote_tolerance_bps")},
  ${positive("order_expiry_days")},
  ${amount("copy_per_buy_usd_micros")},
  ${amount("copy_per_leader_day_usd_micros")},
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE approval_modes (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents (id),
  mode TEXT NOT NULL CHECK (mode IN ('manual', 'auto')),
  changed_by_surface TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE send_levels (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents (id),
  level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 3),
  pending_level INTEGER CHECK (pending_level BETWEEN 0 AND 3),
  pending_at INTEGER,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  CHECK ((pending_level IS NULL) = (pending_at IS NULL))
) STRICT;

CREATE TABLE address_book (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  chain TEXT NOT NULL,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  usable_at INTEGER NOT NULL,
  in_ceiling_at INTEGER,
  created_at INTEGER NOT NULL,
  removed_at INTEGER
) STRICT;

CREATE UNIQUE INDEX address_book_saved ON address_book (agent_id, chain, address)
  WHERE removed_at IS NULL;
`;

const wallets = `
CREATE TABLE wallets (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  family TEXT NOT NULL CHECK (family IN ('evm')),
  custody TEXT NOT NULL CHECK (custody IN ('privy')),
  custody_wallet_id TEXT NOT NULL UNIQUE,
  policy_id TEXT NOT NULL,
  signer_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
) STRICT;

CREATE TABLE ceilings (
  wallet_id TEXT PRIMARY KEY NOT NULL REFERENCES wallets (id),
  policy_id TEXT NOT NULL,
  ${json("policy")},
  ${amount("per_tx_native")},
  read_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE TABLE nonces (
  account TEXT PRIMARY KEY NOT NULL,
  next_nonce INTEGER NOT NULL CHECK (next_nonce >= 0),
  changed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE identities (
  agent_id TEXT PRIMARY KEY NOT NULL REFERENCES agents (id),
  chain TEXT NOT NULL,
  registry TEXT NOT NULL,
  onchain_id TEXT NOT NULL,
  tx_hash TEXT NOT NULL,
  registered_at INTEGER NOT NULL
) STRICT;
`;

/**
 * Creates the agents, their settings and their wallets (database spec, section 2.2): `agents`,
 * `limits`, `approval_modes`, `send_levels`, `address_book`, `wallets`, `ceilings`, `nonces` and
 * `identities`.
 */
export const migration: Migration = {
  name: "0003_agents_and_wallets",
  up(database) {
    database.exec(agents);
    database.exec(wallets);
  },
};
