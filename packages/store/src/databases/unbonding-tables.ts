// The unbondings' table, as SQLite returns it: migration 0055 defines it.
import type { Generated } from "kysely";

/** `stake_unbondings`: the coin each unstake took out, until a claim takes it. */
export interface StakeUnbondingsTable {
  id: Generated<number>;
  intent_id: string;
  wallet_id: string;
  venue: string;
  validator: string | null;
  request_ref: string;
  asset: string;
  amount: string;
  value_usd_micros: string | null;
  ready_at: number;
  claim_intent_id: string | null;
  claimed_at: number | null;
  told_ready_at: number | null;
  paper: number;
}

/** The unbondings' table, by name. */
export interface UnbondingTables {
  stake_unbondings: StakeUnbondingsTable;
}
