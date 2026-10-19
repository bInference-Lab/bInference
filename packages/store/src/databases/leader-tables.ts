// The tables of the tracked wallets, as SQLite returns them: migration 0042 defines them.
import type { Generated } from "kysely";

/** `tracked_wallets`: a wallet an alert or a copy order names, and the blocks read of it. */
interface TrackedWalletsTable {
  account: string;
  since_block: string | null;
  last_block: string | null;
  overflow_blocks: number;
  added_at: number;
  untracked_at: number | null;
  /** The cut blocks the owner was told of, and when (migration 0043). */
  overflow_told_blocks: number;
  overflow_told_at: number | null;
}

/** `wallet_activity`: one trade of a tracked wallet, its amounts as decimal text. */
interface WalletActivityTable {
  id: Generated<number>;
  account: string;
  block: string;
  tx_hash: string;
  log_index: number;
  side: string;
  asset: string;
  amount: string;
  counter_asset: string;
  counter_amount: string;
  value_usd_micros: string | null;
  share_sold_bps: number | null;
  venue: string | null;
  at: number;
}

/** `watch_cursors`: where a log watcher of a chain stopped. */
interface WatchCursorsTable {
  watcher: string;
  chain: string;
  block: string;
  block_hash: string;
  at: number;
}

/** The tables of the tracked wallets, by name. */
export interface LeaderTables {
  tracked_wallets: TrackedWalletsTable;
  wallet_activity: WalletActivityTable;
  watch_cursors: WatchCursorsTable;
}
