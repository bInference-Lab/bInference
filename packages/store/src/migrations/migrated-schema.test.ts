import type { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it } from "vitest";
import { agentDatabase } from "../databases/agent-database.js";
import { engineDatabase } from "../databases/engine-database.js";
import { createTestDatabases } from "../testing/test-databases.worker.js";

const databases = createTestDatabases();
afterAll(() => {
  databases.closeAll();
});

interface TableShape {
  readonly strict: boolean;
  readonly columns: readonly string[];
}

const text = (value: unknown): string => String(value);

// A list of column names written as one line of text, one space between names.
const names = (list: string): readonly string[] => list.split(" ");

// The tables a migration created, without SQLite's own and FTS5's shadow tables.
function describeTables(database: DatabaseSync): Record<string, TableShape> {
  const tables = database
    .prepare("SELECT name, strict FROM pragma_table_list WHERE schema = 'main' AND type = 'table'")
    .all()
    .filter((row) => !/^sqlite_|_fts_/.test(text(row["name"])));
  return Object.fromEntries(
    tables.map((row) => {
      const name = text(row["name"]);
      const info = database
        .prepare(`SELECT name FROM pragma_table_info('${name}') ORDER BY cid`)
        .all();
      return [
        name,
        { strict: row["strict"] === 1, columns: info.map((column) => text(column["name"])) },
      ];
    }),
  );
}

function primaryKeys(database: DatabaseSync, table: string): readonly string[] {
  return database
    .prepare(`SELECT name FROM pragma_table_info('${table}') WHERE pk > 0 ORDER BY pk`)
    .all()
    .map((row) => text(row["name"]));
}

// Each index other than a key's, as `unique|columns|partial` or `index|columns`.
function describeIndexes(database: DatabaseSync, table: string): readonly string[] {
  return database
    .prepare(
      `SELECT name, "unique", partial FROM pragma_index_list('${table}') WHERE origin != 'pk'`,
    )
    .all()
    .map((row) => {
      const indexColumns = database
        .prepare(`SELECT name FROM pragma_index_info('${text(row["name"])}') ORDER BY seqno`)
        .all()
        .map((column) => text(column["name"]));
      const kind = row["unique"] === 1 ? "unique" : "index";
      return [kind, indexColumns.join(","), ...(row["partial"] === 1 ? ["partial"] : [])].join("|");
    })
    .toSorted();
}

// Every table of database spec section 2, with its columns in order. `cards.callback_ref` holds
// the reference Telegram's buttons carry (spec 4, section 2), which section 2 does not list.
const columns: Readonly<Record<string, readonly string[]>> = {
  meta: names("key value"),
  safety: names(
    "id frozen_at rescue_address pending_rescue_address pending_rescue_at disclaimer_version " +
      "disclaimer_accepted_at version",
  ),
  custody: names(
    "id provider app_id owner_quorum_id owner_key_public agent_quorum_id agent_key_public " +
      "attached_at version",
  ),
  agents: names(
    "id name mode frozen_at archived_at locale models notifications created_at changed_at " +
      "version",
  ),
  limits: names(
    "agent_id per_trade_usd_micros rolling_day_usd_micros slippage_registry_bps " +
      "slippage_other_bps price_impact_bps tax_bps liquidity_floor_usd_micros " +
      "min_health_factor_bp gas_reserve venues allow_tokens deny_tokens model_budget_usd_micros " +
      "card_trade_expiry_s card_other_expiry_s requote_after_s requote_tolerance_bps " +
      "order_expiry_days copy_per_buy_usd_micros copy_per_leader_day_usd_micros changed_at " +
      "version",
  ),
  approval_modes: names("agent_id mode changed_by_surface changed_at version"),
  send_levels: names("agent_id level pending_level pending_at changed_at version"),
  address_book: names(
    "id agent_id chain address label usable_at in_ceiling_at created_at removed_at",
  ),
  wallets: names(
    "id agent_id family custody custody_wallet_id policy_id signer_id address label created_at " +
      "archived_at",
  ),
  ceilings: names("wallet_id policy_id policy per_tx_native read_at version"),
  nonces: names("account next_nonce changed_at"),
  identities: names("agent_id chain registry onchain_id tx_hash registered_at"),
  intents: names(
    "id agent_id wallet_id kind state reason request plan quote risk simulation authorized_by " +
      "outside_content paper proposer created_at changed_at version",
  ),
  intent_events: names("id intent_id from_state to_state cause at"),
  cards: names(
    "id intent_id version terms_hash callback_ref opened_at expires_at closed_at close_reason",
  ),
  card_messages: names("card_id surface chat_id topic_id message_id sent_at"),
  confirmations: names(
    "id intent_id card_id card_version terms_hash by_surface by_ref at expires_at",
  ),
  txs: names(
    "id intent_id step chain account nonce state raw hash gas_price relays supersedes " +
      "block_number receipt signed_at sent_at included_at final_at",
  ),
  tx_sends: names("tx_id attempt place relay outcome reason code at"),
  executions: names(
    "id intent_id wallet_id asset_in amount_in asset_out amount_out price_usd_micros " +
      "fee_usd_micros gas_usd_micros paper at",
  ),
  positions: names(
    "wallet_id asset paper quantity cost_usd_micros realized_usd_micros changed_at version",
  ),
  orders: names(
    "id agent_id wallet_id kind state request trigger_state fills max_fills expires_at card_id " +
      "created_at changed_at version",
  ),
  order_fills: names("id order_id intent_id outcome reason at"),
  alerts: names("id agent_id condition state created_at fired_at"),
  webhook_rules: names(
    "id agent_id name secret_hash action state rate_per_min fills max_fills expires_at card_id " +
      "created_at changed_at version",
  ),
  webhook_events: names("id rule_id alert_id body_hash received_at outcome intent_id"),
  schedules: names("id agent_id when prompt next_at last_at state created_by created_at"),
  ledger: names("seq id at agent_id kind subject data prev_hash hash"),
  prices: names("asset source usd_micros at"),
  risk_cache: names("asset source result fetched_at"),
  inbox: names("id source source_key payload received_at handled_at"),
  outbox: names("id surface target payload state attempts next_at ref created_at sent_at"),
  notices: names("id agent_id kind i18n_key values level at delivered"),
  idempotency: names("credential op key args_hash result at"),
  model_usage: names(
    "id agent_id turn_id model input_tokens output_tokens cached_tokens usd_micros at",
  ),
  tokens: names("id label kind scopes secret_hash created_at last_used_at revoked_at"),
  devices: names("id label alg public_key created_at last_seen_at revoked_at"),
  pair_codes: names("code_hash expires_at used_at"),
  config_journal: names("id at by surface path before after reason"),
  plugins: names("id name version tier source hash permissions enabled installed_at"),
  skills: names("id agent_id name source hash installed_at"),
  jobs: names("id kind state progress result error started_at ended_at"),
  backups: names("id path bytes kind created_at verified_at"),
  cex_connections: names("provider state secret_ref scopes connected_at"),
};

// The keys of section 2: a composite key where it names one, and `id` (or the one key it
// names) everywhere else.
const compositeKeys: Readonly<Record<string, readonly string[]>> = {
  meta: ["key"],
  limits: ["agent_id"],
  approval_modes: ["agent_id"],
  send_levels: ["agent_id"],
  ceilings: ["wallet_id"],
  nonces: ["account"],
  tx_sends: ["tx_id", "attempt", "place"],
  identities: ["agent_id"],
  card_messages: ["card_id", "surface", "message_id"],
  positions: ["wallet_id", "asset", "paper"],
  ledger: ["seq"],
  prices: ["asset", "source"],
  risk_cache: ["asset", "source"],
  idempotency: ["credential", "op", "key"],
  pair_codes: ["code_hash"],
  cex_connections: ["provider"],
};

// Every index of section 2 beside the keys, as `unique|columns|partial` or `index|columns`.
const indexes: Readonly<Record<string, readonly string[]>> = {
  agents: ["unique|name"],
  address_book: ["unique|agent_id,chain,address|partial"],
  wallets: ["unique|address", "unique|custody_wallet_id"],
  intents: ["index|agent_id,state", "index|state,changed_at"],
  intent_events: ["index|intent_id,at"],
  cards: ["unique|callback_ref", "unique|intent_id,version"],
  confirmations: ["unique|intent_id"],
  txs: ["index|hash", "index|intent_id,step", "unique|account,nonce|partial"],
  tx_sends: ["unique|tx_id,attempt,relay"],
  executions: ["index|wallet_id,at"],
  orders: ["index|state,agent_id"],
  order_fills: ["index|order_id,at"],
  alerts: ["index|state"],
  webhook_rules: ["index|state"],
  webhook_events: ["index|rule_id,alert_id", "index|rule_id,received_at"],
  schedules: ["index|state,next_at"],
  ledger: ["unique|hash", "unique|id"],
  inbox: ["unique|source_key"],
  outbox: ["index|state,next_at"],
  notices: ["index|at"],
  model_usage: ["index|agent_id,at"],
  tokens: ["unique|secret_hash"],
  config_journal: ["index|at"],
  plugins: ["unique|name"],
  skills: ["unique|agent_id,name"],
  jobs: ["index|state"],
  backups: ["index|created_at"],
};

const keyOf = (table: string): readonly string[] => compositeKeys[table] ?? ["id"];
const indexesOf = (table: string): readonly string[] => indexes[table] ?? [];

describe("the engine database", () => {
  const { database } = databases.open(engineDatabase);
  const tables = describeTables(database);

  it("holds every table of the spec, each STRICT, with its columns in snake_case", () => {
    expect(Object.keys(tables).toSorted()).toStrictEqual(Object.keys(columns).toSorted());
    for (const [table, shape] of Object.entries(tables)) {
      expect({ table, strict: shape.strict, columns: shape.columns }).toStrictEqual({
        table,
        strict: true,
        columns: columns[table],
      });
      expect(shape.columns.filter((column) => !/^[a-z][a-z0-9_]*$/.test(column))).toStrictEqual([]);
    }
  });

  it("keys every table as the spec does", () => {
    for (const table of Object.keys(columns)) {
      expect({ table, key: primaryKeys(database, table) }).toStrictEqual({
        table,
        key: keyOf(table),
      });
    }
  });

  it("indexes every table as the spec does", () => {
    for (const table of Object.keys(columns)) {
      expect({ table, indexes: describeIndexes(database, table) }).toStrictEqual({
        table,
        indexes: indexesOf(table),
      });
    }
  });
});

describe("the agent database", () => {
  const { database } = databases.open(agentDatabase);

  it("holds every table of the spec, each STRICT, and the notes index", () => {
    expect(describeTables(database)).toStrictEqual({
      meta: { strict: true, columns: ["key", "value"] },
      sessions: {
        strict: true,
        columns: names("id agent_id surface conversation started_at cleared_at summary version"),
      },
      turns: {
        strict: true,
        columns: names("id session_id started_at ended_at outcome committed outside_content model"),
      },
      transcript_events: {
        strict: true,
        columns: names("id session_id turn_id seq role kind content at"),
      },
      notes: {
        strict: true,
        columns: names("id agent_id text origin created_at changed_at deleted_at"),
      },
    });
    const fts = database
      .prepare("SELECT type FROM pragma_table_list WHERE name = 'notes_fts'")
      .all()
      .map((row) => text(row["type"]));
    expect(fts).toStrictEqual(["virtual"]);
    expect(describeIndexes(database, "sessions")).toStrictEqual(["index|agent_id,conversation"]);
    expect(describeIndexes(database, "turns")).toStrictEqual(["index|session_id,started_at"]);
    expect(describeIndexes(database, "transcript_events")).toStrictEqual(["unique|session_id,seq"]);
    expect(describeIndexes(database, "notes")).toStrictEqual(["index|agent_id"]);
  });
});
