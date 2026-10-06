import type { Migration } from "../migration.js";

// Each migration keeps its own helpers: a released file never changes, and a helper it shared with
// a later migration could. An amount is a decimal string of base units with no sign and no leading
// zero; a signed amount may start with one minus sign; a hash is 64 lowercase hex digits.
const digits = (value: string): string =>
  `${value} != '' AND ${value} NOT GLOB '*[^0-9]*' AND (${value} = '0' OR ${value} NOT GLOB '0*')`;
const amount = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (${digits(column)} AND length(${column}) <= 78)`;
const signedAmount = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (${digits(`ltrim(${column}, '-')`)} ` +
  `AND ${column} NOT GLOB '--*' AND ${column} != '-0' AND length(${column}) <= 79)`;
const hash = (column: string): string =>
  `${column} TEXT NOT NULL CHECK (length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*')`;
const flag = (column: string): string => `${column} INTEGER NOT NULL CHECK (${column} IN (0, 1))`;
const json = (column: string): string => `${column} TEXT CHECK (json_valid(${column}))`;

const intents = `
CREATE TABLE intents (
  id TEXT PRIMARY KEY NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  reason TEXT,
  ${json("request")} NOT NULL,
  ${json("plan")},
  ${json("quote")},
  ${json("risk")},
  ${json("simulation")},
  ${json("authorized_by")},
  ${flag("outside_content")},
  ${flag("paper")},
  proposer TEXT NOT NULL CHECK (
    proposer IN ('telegram', 'engine') OR proposer GLOB 'tok_*' OR proposer GLOB 'dev_*'
  ),
  created_at INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX intents_agent_state ON intents (agent_id, state);
CREATE INDEX intents_state_changed ON intents (state, changed_at);

CREATE TABLE intent_events (
  id INTEGER PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  ${json("cause")} NOT NULL,
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX intent_events_intent_at ON intent_events (intent_id, at);
`;

const cards = `
CREATE TABLE cards (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  ${hash("terms_hash")},
  callback_ref TEXT UNIQUE,
  opened_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  closed_at INTEGER,
  close_reason TEXT,
  UNIQUE (intent_id, version),
  CHECK ((closed_at IS NULL) = (close_reason IS NULL))
) STRICT;

CREATE TABLE card_messages (
  card_id TEXT NOT NULL REFERENCES cards (id),
  surface TEXT NOT NULL CHECK (surface IN ('telegram', 'console', 'mini')),
  chat_id TEXT,
  topic_id TEXT,
  message_id TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (card_id, surface, message_id)
) STRICT;

CREATE TABLE confirmations (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL UNIQUE REFERENCES intents (id),
  card_id TEXT NOT NULL REFERENCES cards (id),
  card_version INTEGER NOT NULL,
  ${hash("terms_hash")},
  by_surface TEXT NOT NULL,
  by_ref TEXT NOT NULL,
  at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (intent_id, card_version) REFERENCES cards (intent_id, version)
) STRICT;
`;

const transactions = `
CREATE TABLE txs (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  step INTEGER NOT NULL CHECK (step >= 0),
  chain TEXT NOT NULL,
  account TEXT NOT NULL,
  nonce INTEGER NOT NULL CHECK (nonce >= 0),
  state TEXT NOT NULL,
  raw TEXT,
  hash TEXT,
  gas_price TEXT CHECK (${digits("gas_price")}),
  ${json("relays")},
  supersedes TEXT REFERENCES txs (id),
  block_number INTEGER CHECK (block_number >= 0),
  ${json("receipt")},
  signed_at INTEGER,
  sent_at INTEGER,
  included_at INTEGER,
  final_at INTEGER
) STRICT;

CREATE UNIQUE INDEX txs_account_nonce ON txs (account, nonce)
  WHERE state IN ('signed', 'sent', 'included', 'final');
CREATE INDEX txs_hash ON txs (hash);
CREATE INDEX txs_intent_step ON txs (intent_id, step);

CREATE TABLE executions (
  id INTEGER PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  asset_in TEXT NOT NULL,
  ${amount("amount_in")},
  asset_out TEXT NOT NULL,
  ${amount("amount_out")},
  ${amount("price_usd_micros")},
  ${amount("fee_usd_micros")},
  ${amount("gas_usd_micros")},
  ${flag("paper")},
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX executions_wallet_at ON executions (wallet_id, at);

CREATE TABLE positions (
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  asset TEXT NOT NULL,
  ${flag("paper")},
  ${amount("quantity")},
  ${amount("cost_usd_micros")},
  ${signedAmount("realized_usd_micros")},
  changed_at INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (wallet_id, asset, paper)
) STRICT;
`;

/**
 * Creates intents and what they leave behind (database spec, section 2.3): `intents`,
 * `intent_events`, `cards`, `card_messages`, `confirmations`, `txs`, `executions` and
 * `positions`. A nonce is unique per account among signed, sent, included and final transactions.
 */
export const migration: Migration = {
  name: "0004_intents_and_transactions",
  up(database) {
    database.exec(intents);
    database.exec(cards);
    database.exec(transactions);
  },
};
