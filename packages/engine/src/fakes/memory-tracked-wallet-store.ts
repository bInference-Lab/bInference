import { type AccountRef, accountRefParts } from "@binference/chain";
import type { TrackedWalletStore } from "../leaders/ports.js";
import {
  activityKeyOf,
  type LeaderReadRecord,
  type StoredActivity,
  type WatchCursorRecord,
} from "../leaders/tracked-wallet-record.js";
import { memoryCall } from "./memory-call.js";
import type { MemoryTracking, TrackedRow } from "./memory-tracking.js";

interface Rows {
  /** The stored trades by number, from 1. */
  readonly activity: Map<number, StoredActivity>;
  readonly cursors: Map<string, WatchCursorRecord>;
}

function isTracked(row: TrackedRow, named: ReadonlySet<AccountRef>): boolean {
  return row.untrackedAtMs === undefined && named.has(row.account);
}

// The row of an account tracked now.
function liveRow(tracking: MemoryTracking, account: AccountRef): TrackedRow | undefined {
  const row = tracking.rows.get(account);
  return row?.untrackedAtMs === undefined ? row : undefined;
}

function moveWallets(tracking: MemoryTracking, read: LeaderReadRecord): void {
  for (const { account, sinceBlock, readFrom } of read.wallets) {
    const row = liveRow(tracking, account);
    if (row !== undefined && read.to >= readFrom) {
      const since = row.sinceBlock ?? sinceBlock;
      tracking.rows.set(account, { ...row, sinceBlock: since, lastBlock: read.to });
    }
  }
  for (const { account } of read.overflows) {
    const row = liveRow(tracking, account);
    if (row !== undefined) {
      tracking.rows.set(account, { ...row, overflowBlocks: row.overflowBlocks + 1 });
    }
  }
}

function record(
  rows: Rows,
  tracking: MemoryTracking,
  read: LeaderReadRecord,
): readonly StoredActivity[] {
  const known = new Set([...rows.activity.values()].map(activityKeyOf));
  const stored: StoredActivity[] = [];
  for (const trade of read.trades) {
    const key = activityKeyOf(trade);
    if (liveRow(tracking, trade.account) !== undefined && !known.has(key)) {
      known.add(key);
      const id = rows.activity.size + 1;
      rows.activity.set(id, { ...trade, id });
      stored.push({ ...trade, id });
    }
  }
  moveWallets(tracking, read);
  const cursor = { chain: read.chain, block: read.to, blockHash: read.toHash, atMs: read.atMs };
  rows.cursors.set(read.chain, cursor);
  return stored;
}

/** Creates an in-memory {@link TrackedWalletStore} over the tracking the alert and order fakes keep. */
export function createMemoryTrackedWalletStore(tracking: MemoryTracking): TrackedWalletStore {
  const rows: Rows = { activity: new Map(), cursors: new Map() };
  return {
    async tracked(chain, call) {
      call.signal.throwIfAborted();
      const named = await tracking.named(call);
      return [...tracking.rows.values()]
        .filter((row) => isTracked(row, named) && accountRefParts(row.account).chain === chain)
        .map(({ untrackedAtMs: _untracked, ...row }) => structuredClone(row));
    },
    cursor: async (chain, call) => memoryCall(call, () => structuredClone(rows.cursors.get(chain))),
    record: async (read, call) =>
      memoryCall(call, () => record(rows, tracking, structuredClone(read))),
    activity: async (query, call) =>
      memoryCall(call, () =>
        structuredClone(
          [...rows.activity.values()]
            .filter(
              (trade) =>
                trade.account === query.account &&
                (query.fromMs === undefined || trade.atMs >= query.fromMs) &&
                (query.toMs === undefined || trade.atMs <= query.toMs) &&
                (query.before === undefined ||
                  trade.atMs < query.before.atMs ||
                  (trade.atMs === query.before.atMs && trade.id < query.before.id)),
            )
            .toSorted((left, right) => right.atMs - left.atMs || right.id - left.id)
            .slice(0, query.limit),
        ),
      ),
  };
}
