import { BinferenceError } from "@binference/core";
import type { Migration } from "../migration.js";

// This migration's own column checks, as a released file never changes. An amount is a decimal
// string of base units, at most 78 digits, with no sign and no leading zero; a transaction hash
// fits the id grammar every family's hashes fit.
const isDecimal = (column: string): string =>
  [
    `${column} != ''`,
    `${column} NOT GLOB '*[^0-9]*'`,
    `(${column} = '0' OR ${column} NOT GLOB '0*')`,
    `length(${column}) <= 78`,
  ].join(" AND ");
const amount = (column: string): string => `${column} TEXT NOT NULL CHECK (${isDecimal(column)})`;
const optionalAmount = (column: string): string =>
  `${column} TEXT CHECK (${column} IS NULL OR (${isDecimal(column)}))`;
const txHash = (column: string): string =>
  `${column} TEXT CHECK (${column} IS NULL OR (length(${column}) BETWEEN 1 AND 128 ` +
  `AND ${column} NOT GLOB '*[^-.%a-zA-Z0-9]*'))`;
const flag = (column: string): string => `${column} INTEGER NOT NULL CHECK (${column} IN (0, 1))`;

// The execution record names the venue's fee in units of the sold asset, the gas as an amount of
// the native coin and the settling transaction, which 0004's table had no column for.
const executions = `
DROP TABLE executions;

CREATE TABLE executions (
  id INTEGER PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  asset_in TEXT NOT NULL,
  ${amount("amount_in")},
  ${amount("fee_amount")},
  asset_out TEXT NOT NULL,
  ${amount("amount_out")},
  gas_asset TEXT NOT NULL,
  ${amount("gas_amount")},
  ${txHash("tx_hash")},
  ${amount("value_usd_micros")},
  ${amount("fee_usd_micros")},
  ${amount("gas_usd_micros")},
  ${flag("paper")},
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX executions_wallet_at ON executions (wallet_id, at);
`;

const arrivals = `
CREATE TABLE arrivals (
  id INTEGER PRIMARY KEY NOT NULL,
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  asset TEXT NOT NULL,
  ${amount("amount")},
  ${optionalAmount("value_usd_micros")},
  ${txHash("tx_hash")},
  ${flag("paper")},
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX arrivals_wallet_at ON arrivals (wallet_id, at);
`;

const departures = `
CREATE TABLE departures (
  id INTEGER PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES intents (id),
  wallet_id TEXT NOT NULL REFERENCES wallets (id),
  asset TEXT NOT NULL,
  ${amount("amount")},
  gas_asset TEXT NOT NULL,
  ${amount("gas_amount")},
  ${txHash("tx_hash")} NOT NULL,
  at INTEGER NOT NULL
) STRICT;

CREATE INDEX departures_wallet_at ON departures (wallet_id, at);
CREATE INDEX departures_intent ON departures (intent_id);
`;

// No store adapter wrote `executions` before this migration, so it holds no row. One that does
// would be lost by the rebuild: the migration stops instead, and nothing changes.
function refuseHeldExecutions(database: Parameters<Migration["up"]>[0]): void {
  const held = database.prepare("SELECT count(*) AS held FROM executions").get();
  if (held?.["held"] !== 0) {
    throw new BinferenceError({
      code: "store.migration_refused",
      message: "The executions table holds rows that the rebuild would lose.",
    });
  }
}

/**
 * Makes `executions` again with the fee in units of the sold asset, the gas as an amount and the
 * settling transaction, its sold value named `value_usd_micros`; and creates `arrivals` and
 * `departures` (database spec, section 2.3; decision 0127).
 */
export const migration: Migration = {
  name: "0015_positions_and_departures",
  up(database) {
    refuseHeldExecutions(database);
    database.exec(executions);
    database.exec(arrivals);
    database.exec(departures);
  },
};
