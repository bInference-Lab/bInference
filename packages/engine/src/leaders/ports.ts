import type { ChainRef } from "@binference/chain";
import type {
  ActivityQuery,
  ActivitySinceQuery,
  LeaderReadRecord,
  OverflowQuery,
  OverflowToTell,
  StoredActivity,
  TrackedWalletRecord,
  WatchCursorRecord,
} from "./tracked-wallet-record.js";

/** What every store call takes: a call on an aborted signal rejects and changes nothing. */
interface StoreCall {
  readonly signal: AbortSignal;
}

/**
 * Keeps the tracked wallets, their trades and the leader watcher's cursor (database spec,
 * section 2.6; decisions 0250 and 0251). The rows of `tracked_wallets` follow the alert and order
 * stores' writes (decision 0251); this port reads them and stores what the watcher read. No call
 * reaches the money path.
 */
export interface TrackedWalletStore {
  /**
   * The wallets tracked on a chain now: rows without `untracked_at` whose account an active wallet
   * alert or a live copy order of an agent not archived still names.
   */
  tracked(chain: ChainRef, call: StoreCall): Promise<readonly TrackedWalletRecord[]>;
  /** The leader watcher's cursor on a chain, if it stored one. */
  cursor(chain: ChainRef, call: StoreCall): Promise<WatchCursorRecord | undefined>;
  /**
   * Stores one read in one write: each trade of a wallet tracked now, once on its account, hash
   * and log index; one more overflow block per cut block of a tracked wallet; for each tracked
   * wallet whose `readFrom` the read reached, its `since_block` when it had none and its
   * `last_block`; and the cursor at `to`. Answers the trades stored new, in the read's order.
   */
  record(read: LeaderReadRecord, call: StoreCall): Promise<readonly StoredActivity[]>;
  /**
   * The tracked wallets with blocks cut since the owner was last told of them, each told at most
   * once in `everyMs` (decision 0250), with how many; each is marked told at `atMs` in the same
   * write, so it is told once. At most `limit`, in account order.
   */
  overflowsToTell(query: OverflowQuery, call: StoreCall): Promise<readonly OverflowToTell[]>;
  /** One account's stored trades, newest first by time, then by number. */
  activity(query: ActivityQuery, call: StoreCall): Promise<readonly StoredActivity[]>;
  /**
   * One account's trades stored after a given one, in the order they were stored, which is block
   * and log order: the trades a copy order has not read yet.
   */
  since(query: ActivitySinceQuery, call: StoreCall): Promise<readonly StoredActivity[]>;
}
