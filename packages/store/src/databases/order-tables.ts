// The tables of the order store, as SQLite returns them: migration 0031 makes `orders` again.

/** `orders`: one auto order (migration 0031); JSON documents as text, flags as 0 or 1. */
export interface OrdersTable {
  id: string;
  agent_id: string;
  wallet_id: string;
  kind: string;
  state: string;
  request: string;
  trigger_state: string | null;
  fills: number;
  max_fills: number | null;
  expires_at: number;
  intent_id: string;
  card_id: string | null;
  paper: number;
  outside_content: number;
  end_reason: string | null;
  expiry_noticed_at: number | null;
  created_at: number;
  changed_at: number;
  version: number;
}

/** `order_fills`: one fill or skip of an auto order (migration 0031). */
export interface OrderFillsTable {
  id: string;
  order_id: string;
  intent_id: string | null;
  outcome: string;
  reason: string | null;
  at: number;
  /** The notices of the fill or skip as JSON, their pushes' data (migration 0032). */
  notices: string | null;
  announced_at: number | null;
  /** A copy order's row: the leader trade it copied and the take it ran under (migration 0045). */
  copy_trade: number | null;
  copy_take: number | null;
}

/** The order store's tables, by name. */
export interface OrderTables {
  orders: OrdersTable;
  order_fills: OrderFillsTable;
}
