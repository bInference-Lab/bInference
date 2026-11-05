import type { PostgresMigration } from "../postgres-migration.js";

// A released migration never changes, so it writes its SQL out in full. An amount is
// numeric(78,0) and never below zero; a rate is 0 to 10,000 basis points.
const sql = `
CREATE TABLE agents (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  name text COLLATE "C" NOT NULL UNIQUE,
  mode text COLLATE "C" NOT NULL CHECK (mode IN ('paper', 'live')),
  frozen_at bigint,
  archived_at bigint,
  locale text COLLATE "C" NOT NULL,
  models text COLLATE "C" NOT NULL CHECK (models IS JSON),
  notifications text COLLATE "C" NOT NULL CHECK (notifications IS JSON),
  created_at bigint NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE limits (
  agent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES agents (id),
  per_trade_usd_micros numeric(78,0) NOT NULL CHECK (per_trade_usd_micros >= 0),
  rolling_day_usd_micros numeric(78,0) NOT NULL CHECK (rolling_day_usd_micros >= 0),
  slippage_registry_bps bigint NOT NULL CHECK (slippage_registry_bps BETWEEN 0 AND 10000),
  slippage_other_bps bigint NOT NULL CHECK (slippage_other_bps BETWEEN 0 AND 10000),
  price_impact_bps bigint NOT NULL CHECK (price_impact_bps BETWEEN 0 AND 10000),
  tax_bps bigint NOT NULL CHECK (tax_bps BETWEEN 0 AND 10000),
  liquidity_floor_usd_micros numeric(78,0) NOT NULL CHECK (liquidity_floor_usd_micros >= 0),
  min_health_factor_bp bigint NOT NULL CHECK (min_health_factor_bp >= 0),
  gas_reserve text COLLATE "C" NOT NULL CHECK (gas_reserve IS JSON),
  venues text COLLATE "C" NOT NULL CHECK (venues IS JSON),
  allow_tokens text COLLATE "C" NOT NULL CHECK (allow_tokens IS JSON),
  deny_tokens text COLLATE "C" NOT NULL CHECK (deny_tokens IS JSON),
  model_budget_usd_micros numeric(78,0) NOT NULL CHECK (model_budget_usd_micros >= 0),
  card_trade_expiry_s bigint NOT NULL CHECK (card_trade_expiry_s > 0),
  card_other_expiry_s bigint NOT NULL CHECK (card_other_expiry_s > 0),
  requote_after_s bigint NOT NULL CHECK (requote_after_s > 0),
  requote_tolerance_bps bigint NOT NULL CHECK (requote_tolerance_bps BETWEEN 0 AND 10000),
  order_expiry_days bigint NOT NULL CHECK (order_expiry_days > 0),
  copy_per_buy_usd_micros numeric(78,0) NOT NULL CHECK (copy_per_buy_usd_micros >= 0),
  copy_per_leader_day_usd_micros numeric(78,0) NOT NULL
    CHECK (copy_per_leader_day_usd_micros >= 0),
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE approval_modes (
  agent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES agents (id),
  mode text COLLATE "C" NOT NULL CHECK (mode IN ('manual', 'auto')),
  changed_by_surface text COLLATE "C" NOT NULL,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE send_levels (
  agent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES agents (id),
  level bigint NOT NULL CHECK (level BETWEEN 0 AND 3),
  pending_level bigint CHECK (pending_level BETWEEN 0 AND 3),
  pending_at bigint,
  changed_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  CHECK ((pending_level IS NULL) = (pending_at IS NULL))
);

CREATE TABLE address_book (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  chain text COLLATE "C" NOT NULL,
  address text COLLATE "C" NOT NULL,
  label text COLLATE "C" NOT NULL,
  usable_at bigint NOT NULL,
  in_ceiling_at bigint,
  created_at bigint NOT NULL,
  removed_at bigint
);

CREATE UNIQUE INDEX address_book_saved ON address_book (agent_id, chain, address)
  WHERE removed_at IS NULL;

CREATE TABLE wallets (
  id text COLLATE "C" PRIMARY KEY NOT NULL,
  agent_id text COLLATE "C" NOT NULL REFERENCES agents (id),
  family text COLLATE "C" NOT NULL CHECK (family IN ('evm')),
  custody text COLLATE "C" NOT NULL CHECK (custody IN ('privy')),
  custody_wallet_id text COLLATE "C" NOT NULL UNIQUE,
  policy_id text COLLATE "C" NOT NULL,
  signer_id text COLLATE "C" NOT NULL,
  address text COLLATE "C" NOT NULL UNIQUE,
  label text COLLATE "C" NOT NULL,
  created_at bigint NOT NULL,
  archived_at bigint
);

CREATE TABLE ceilings (
  wallet_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES wallets (id),
  policy_id text COLLATE "C" NOT NULL,
  policy text COLLATE "C" NOT NULL CHECK (policy IS JSON),
  per_tx_native numeric(78,0) NOT NULL CHECK (per_tx_native >= 0),
  read_at bigint NOT NULL,
  version bigint NOT NULL DEFAULT 0
);

CREATE TABLE nonces (
  account text COLLATE "C" PRIMARY KEY NOT NULL,
  next_nonce bigint NOT NULL CHECK (next_nonce >= 0),
  changed_at bigint NOT NULL
);

CREATE TABLE identities (
  agent_id text COLLATE "C" PRIMARY KEY NOT NULL REFERENCES agents (id),
  chain text COLLATE "C" NOT NULL,
  registry text COLLATE "C" NOT NULL,
  onchain_id text COLLATE "C" NOT NULL,
  tx_hash text COLLATE "C" NOT NULL,
  registered_at bigint NOT NULL
);
`;

/**
 * Creates the agents, their settings and their wallets (database spec, section 2.2), as engine 0003
 * does.
 */
export const migration: PostgresMigration = { name: "0003_agents_and_wallets", sql };
