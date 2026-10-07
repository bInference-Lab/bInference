import type { Generated } from "kysely";

// The engine tables the store adapters query, as SQLite returns them: TEXT is a string, INTEGER a
// number, and a nullable column may be null. The migrations in src/migrations/engine/ define them.

/** `agents`. */
export interface AgentsTable {
  id: string;
  name: string;
  mode: string;
  frozen_at: number | null;
  archived_at: number | null;
  locale: string;
  models: string;
  notifications: string;
  created_at: number;
  changed_at: number;
  version: number;
}

/** `limits`: amounts as decimal text, lists and the gas reserve as JSON text. */
export interface LimitsTable {
  agent_id: string;
  per_trade_usd_micros: string;
  rolling_day_usd_micros: string;
  slippage_registry_bps: number;
  slippage_other_bps: number;
  price_impact_bps: number;
  tax_bps: number;
  liquidity_floor_usd_micros: string;
  min_health_factor_bp: number;
  gas_reserve: string;
  venues: string;
  allow_tokens: string;
  deny_tokens: string;
  model_budget_usd_micros: string;
  card_trade_expiry_s: number;
  card_other_expiry_s: number;
  requote_after_s: number;
  requote_tolerance_bps: number;
  order_expiry_days: number;
  copy_per_buy_usd_micros: string;
  copy_per_leader_day_usd_micros: string;
  changed_at: number;
  version: number;
}

/** `approval_modes`. */
export interface ApprovalModesTable {
  agent_id: string;
  mode: string;
  changed_by_surface: string;
  changed_at: number;
  version: number;
}

/** `wallets`. */
interface WalletsTable {
  id: string;
  agent_id: string;
  family: string;
  custody: string;
  custody_wallet_id: string;
  policy_id: string;
  signer_id: string;
  address: string;
  label: string;
  created_at: number;
  archived_at: number | null;
}

/** `intents`: JSON documents as text, flags as 0 or 1. */
export interface IntentsTable {
  id: string;
  agent_id: string;
  wallet_id: string;
  kind: string;
  state: string;
  reason: string | null;
  request: string;
  plan: string | null;
  quote: string | null;
  risk: string | null;
  simulation: string | null;
  authorized_by: string | null;
  outside_content: number;
  paper: number;
  proposer: string;
  created_at: number;
  changed_at: number;
  version: number;
}

/** `intent_events`. */
export interface IntentEventsTable {
  id: Generated<number>;
  intent_id: string;
  from_state: string | null;
  to_state: string;
  cause: string;
  at: number;
}

/** `cards`. */
export interface CardsTable {
  id: string;
  intent_id: string;
  version: number;
  terms_hash: string;
  callback_ref: string | null;
  opened_at: number;
  expires_at: number;
  closed_at: number | null;
  close_reason: string | null;
}

/** `confirmations`. */
export interface ConfirmationsTable {
  id: string;
  intent_id: string;
  card_id: string;
  card_version: number;
  terms_hash: string;
  by_surface: string;
  by_ref: string;
  at: number;
  expires_at: number;
}

/** `txs`: one row per signed transaction of a step; the nonce is unique among live states. */
export interface TxsTable {
  id: string;
  intent_id: string;
  step: number;
  chain: string;
  account: string;
  nonce: number;
  state: string;
  raw: string | null;
  hash: string | null;
  gas_price: string | null;
  relays: string | null;
  supersedes: string | null;
  block_number: number | null;
  receipt: string | null;
  signed_at: number | null;
  sent_at: number | null;
  included_at: number | null;
  final_at: number | null;
}

/** `nonces`: per account, one past the highest nonce the wallet queue gave. */
interface NoncesTable {
  account: string;
  next_nonce: number;
  changed_at: number;
}

/** `ledger`: append-only; `seq` is given by the adapter, which reads the last one first. */
export interface LedgerTable {
  seq: number;
  id: string;
  at: number;
  agent_id: string | null;
  kind: string;
  subject: string | null;
  data: string;
  prev_hash: string;
  hash: string;
}

/** `idempotency`. */
interface IdempotencyTable {
  credential: string;
  op: string;
  key: string;
  args_hash: string;
  result: string;
  at: number;
}

/** `inbox`. */
export interface InboxTable {
  id: Generated<number>;
  source: string;
  source_key: string;
  payload: string;
  received_at: number;
  handled_at: number | null;
}

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

/** `config_journal`: `before` and `after` hold JSON text, NULL when absent. */
export interface ConfigJournalTable {
  id: Generated<number>;
  at: number;
  by: string;
  surface: string;
  path: string;
  before: string | null;
  after: string | null;
  reason: string | null;
}

/** The engine tables the store adapters query, by name. */
export interface EngineTables {
  agents: AgentsTable;
  limits: LimitsTable;
  approval_modes: ApprovalModesTable;
  wallets: WalletsTable;
  intents: IntentsTable;
  intent_events: IntentEventsTable;
  cards: CardsTable;
  confirmations: ConfirmationsTable;
  ledger: LedgerTable;
  idempotency: IdempotencyTable;
  inbox: InboxTable;
  tokens: TokensTable;
  devices: DevicesTable;
  pair_codes: PairCodesTable;
  config_journal: ConfigJournalTable;
  txs: TxsTable;
  nonces: NoncesTable;
}
