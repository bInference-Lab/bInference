import type { Generated } from "kysely";
import type { AccessTables } from "./access-tables.js";
import type { AgentInboxTables } from "./agent-inbox-tables.js";
import type { BackupTables } from "./backup-tables.js";
import type { ModelUsageTables } from "./model-usage-tables.js";
import type { NoticeTables } from "./notice-tables.js";
import type { OrderTables } from "./order-tables.js";
import type { PositionTables } from "./position-tables.js";
import type { TelegramTables } from "./telegram-tables.js";
import type { WalletTables } from "./wallet-tables.js";

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
  /** The open chat session; NULL until the agent's first message (migration 0028). */
  chat_session_id: string | null;
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
  /** The looser limits that wait, as JSON of the columns above; null when none wait. */
  pending: string | null;
  /** When the limits that wait apply; null when none wait. */
  pending_at: number | null;
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

/** `send_levels`. */
export interface SendLevelsTable {
  agent_id: string;
  level: number;
  pending_level: number | null;
  pending_at: number | null;
  changed_at: number;
  version: number;
}

/** `address_book`. */
export interface AddressBookTable {
  id: string;
  agent_id: string;
  chain: string;
  address: string;
  label: string;
  usable_at: number;
  in_ceiling_at: number | null;
  created_at: number;
  removed_at: number | null;
}

/** `meta`: the schema version, the install id and when the install began. */
interface MetaTable {
  key: string;
  value: string;
}

/** `safety`: its one row, `id = 1`. */
interface SafetyTable {
  id: number;
  frozen_at: number | null;
  rescue_address: string | null;
  pending_rescue_address: string | null;
  pending_rescue_at: number | null;
  rescue_ceiling: string | null;
  disclaimer_version: string | null;
  disclaimer_accepted_at: number | null;
  version: number;
}

/** `custody`: its one row, `id = 1`, once the install is set up. */
export interface CustodyTable {
  id: number;
  provider: string;
  app_id: string;
  owner_quorum_id: string;
  owner_key_public: string;
  agent_quorum_id: string;
  agent_key_public: string;
  attached_at: number;
  /** The sealing key's public half (migration 0027); NULL until the owner key derived it. */
  seal_key_public: string | null;
  version: number;
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
  /** The USD value the policy judged the intent at, in micro-dollars (migration 0016). */
  value_usd_micros: string | null;
  /** What its unlisted tokens answered on chain at its proposal, as JSON (migration 0034). */
  assets: string | null;
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
  /** Where the buy or sell the version shows trades, as JSON; none for any other kind. */
  place: string | null;
  /** Why auto mode opened the version instead of filling, an auto test code; none in manual mode. */
  auto_ask: string | null;
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
  /** `speedUp` or `cancel` for a stuck step's replacement, set with `supersedes`. */
  replacement: string | null;
  block_number: number | null;
  receipt: string | null;
  signed_at: number | null;
  sent_at: number | null;
  included_at: number | null;
  final_at: number | null;
}

/** `tx_sends`: one row per relay per send of a transaction, in the relays' order. */
interface TxSendsTable {
  tx_id: string;
  attempt: number;
  place: number;
  relay: string;
  outcome: string;
  reason: string | null;
  code: number | null;
  at: number;
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

/** `carried_outflows`: outflows a restore carried from the state it replaced (migration 0025). */
interface CarriedOutflowsTable {
  intent_id: string;
  agent_id: string;
  paper: number;
  confirmed_at: number;
  value_usd_micros: string;
  carried_at: number;
}

/** `risk_cache`: one source's report for one token, as JSON text. */
interface RiskCacheTable {
  asset: string;
  source: string;
  result: string;
  fetched_at: number;
}

/** The engine tables the store adapters query, by name. */
export interface EngineTables
  extends
    PositionTables,
    NoticeTables,
    OrderTables,
    TelegramTables,
    BackupTables,
    AccessTables,
    AgentInboxTables,
    ModelUsageTables,
    WalletTables {
  meta: MetaTable;
  safety: SafetyTable;
  custody: CustodyTable;
  agents: AgentsTable;
  limits: LimitsTable;
  approval_modes: ApprovalModesTable;
  send_levels: SendLevelsTable;
  address_book: AddressBookTable;
  intents: IntentsTable;
  intent_events: IntentEventsTable;
  cards: CardsTable;
  confirmations: ConfirmationsTable;
  late_landings: { intent_id: string; tx_id: string; at: number };
  carried_outflows: CarriedOutflowsTable;
  ledger: LedgerTable;
  idempotency: IdempotencyTable;
  inbox: InboxTable;
  config_journal: ConfigJournalTable;
  risk_cache: RiskCacheTable;
  txs: TxsTable;
  tx_sends: TxSendsTable;
  nonces: NoncesTable;
}
