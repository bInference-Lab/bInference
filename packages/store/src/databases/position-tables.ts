import type { Generated } from "kysely";

// The tables of the position store, as SQLite returns them; migration 0015 defines them.

/** `executions`: one trade as it settled or filled on paper; `id` counts from 1. */
export interface ExecutionsTable {
  id: Generated<number>;
  intent_id: string;
  wallet_id: string;
  asset_in: string;
  amount_in: string;
  fee_amount: string;
  asset_out: string;
  amount_out: string;
  gas_asset: string;
  gas_amount: string;
  tx_hash: string | null;
  value_usd_micros: string;
  fee_usd_micros: string;
  gas_usd_micros: string;
  paper: number;
  at: number;
  /** Signed: below zero for a loss; '0' for a row recorded before migration 0017. */
  realized_usd_micros: string;
}

/** `arrivals`: funds that reached a wallet without a trade; no value when no price was known. */
export interface ArrivalsTable {
  id: Generated<number>;
  wallet_id: string;
  asset: string;
  amount: string;
  value_usd_micros: string | null;
  tx_hash: string | null;
  paper: number;
  at: number;
}

/** `departures`: funds one send of an intent took out of a live wallet, with its gas. */
export interface DeparturesTable {
  id: Generated<number>;
  intent_id: string;
  wallet_id: string;
  asset: string;
  amount: string;
  gas_asset: string;
  gas_amount: string;
  tx_hash: string;
  at: number;
}

/** `positions`: one wallet's holding of one asset at average cost, paper and live apart. */
export interface PositionsTable {
  wallet_id: string;
  asset: string;
  paper: number;
  quantity: string;
  cost_usd_micros: string;
  realized_usd_micros: string;
  changed_at: number;
  version: number;
}

/** The tables the position store writes, by name. */
export interface PositionTables {
  executions: ExecutionsTable;
  arrivals: ArrivalsTable;
  departures: DeparturesTable;
  positions: PositionsTable;
}
