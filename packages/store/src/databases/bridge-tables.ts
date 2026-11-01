// The bridges' table, as SQLite returns it: migration 0053 defines it.

/** `bridges`: each bridge's delivery, opened when its deposit is final. */
export interface BridgesTable {
  intent_id: string;
  venue: string;
  deposit_ref: string;
  to_chain: string;
  recipient: string;
  sent_asset: string;
  sent_amount: string;
  delivered_asset: string;
  delivered_coin: string | null;
  min_out: string;
  value_usd_micros: string | null;
  state: string;
  status_url: string | null;
  sent_at: number;
  late_at: number | null;
  fill_tx: string | null;
  received: string | null;
  received_asset: string | null;
  refund_tx: string | null;
  settled_at: number | null;
  checked_at: number | null;
  version: number;
}

/** The bridges' table, by name. */
export interface BridgeTables {
  bridges: BridgesTable;
}
