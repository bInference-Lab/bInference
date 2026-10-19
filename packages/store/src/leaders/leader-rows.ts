// The rows of the tracked wallets and their trades, read into their records.
import {
  type StoredActivity,
  storedActivitySchema,
  type TrackedWalletRecord,
  trackedWalletRecordSchema,
  type WalletActivity,
} from "@binference/engine/orders";
import type { Insertable, Selectable } from "kysely";
import type { LeaderTables } from "../databases/leader-tables.js";
import { decimalText, field, orNull } from "../rows/column-values.js";

type TrackedWalletsTable = LeaderTables["tracked_wallets"];
type WalletActivityTable = LeaderTables["wallet_activity"];

/** Reads one `tracked_wallets` row into its record. */
export function toTrackedWallet(row: Selectable<TrackedWalletsTable>): TrackedWalletRecord {
  return trackedWalletRecordSchema.parse({
    account: row.account,
    ...field("sinceBlock", row.since_block),
    ...field("lastBlock", row.last_block),
    overflowBlocks: row.overflow_blocks,
    addedAtMs: row.added_at,
  });
}

/** Reads one `wallet_activity` row into its record. */
export function toStoredActivity(row: Selectable<WalletActivityTable>): StoredActivity {
  return storedActivitySchema.parse({
    id: row.id,
    account: row.account,
    block: row.block,
    txHash: row.tx_hash,
    logIndex: row.log_index,
    side: row.side,
    asset: row.asset,
    amount: row.amount,
    counterAsset: row.counter_asset,
    counterAmount: row.counter_amount,
    ...field("valueUsdMicros", row.value_usd_micros),
    ...field("shareSoldBps", row.share_sold_bps),
    ...field("venue", row.venue),
    atMs: row.at,
  });
}

/** The `wallet_activity` row of a trade. */
export function activityRowOf(trade: WalletActivity): Insertable<WalletActivityTable> {
  return {
    account: trade.account,
    block: decimalText(trade.block),
    tx_hash: trade.txHash,
    log_index: trade.logIndex,
    side: trade.side,
    asset: trade.asset,
    amount: decimalText(trade.amount),
    counter_asset: trade.counterAsset,
    counter_amount: decimalText(trade.counterAmount),
    value_usd_micros: trade.valueUsdMicros === undefined ? null : decimalText(trade.valueUsdMicros),
    share_sold_bps: orNull(trade.shareSoldBps),
    venue: orNull(trade.venue),
    at: trade.atMs,
  };
}
