import type { DatabaseSync } from "node:sqlite";
import { type ChainRef, chainRefSchema } from "@binference/chain";
import {
  type ActivityQuery,
  activityQuerySchema,
  type ActivitySinceQuery,
  activitySinceQuerySchema,
  type LeaderReadRecord,
  leaderReadRecordSchema,
  type OverflowQuery,
  overflowQuerySchema,
  type OverflowToTell,
  overflowToTellSchema,
  type StoredActivity,
  storedActivitySchema,
  type TrackedWalletRecord,
  trackedWalletRecordSchema,
  type WatchCursorRecord,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  type CursorWatcher,
  watchCursorTaskOf,
  writeWatchCursor,
} from "../watching/watch-cursor-rows.js";
import { activityRowOf, toStoredActivity, toTrackedWallet } from "./leader-rows.js";
import { namedAccounts } from "./tracked-sync.js";

// The leader watcher's row in `watch_cursors`.
const watcher: CursorWatcher = "wallets";

/** The wallets tracked on a chain now, whose account something still names. */
export const trackedWalletsTask: StoreTask<ChainRef, readonly TrackedWalletRecord[]> = defineTask({
  name: "leaders.tracked",
  access: "read",
  input: chainRefSchema,
  output: z.array(trackedWalletRecordSchema),
  run(database, chain) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const named: ReadonlySet<string> = namedAccounts(database);
    const rows = execute(
      kysely
        .selectFrom("tracked_wallets")
        .selectAll()
        .where("untracked_at", "is", null)
        .where("account", "like", `${chain}:%`)
        .orderBy("account"),
    ).rows;
    return rows.filter(({ account }) => named.has(account)).map(toTrackedWallet);
  },
});

/** The leader watcher's cursor on a chain. */
export const watchCursorTask: StoreTask<ChainRef, WatchCursorRecord | undefined> =
  watchCursorTaskOf("leaders.cursor", watcher);

// The accounts of `read` tracked now, by the rows themselves.
function liveAccounts(database: DatabaseSync, read: LeaderReadRecord): ReadonlySet<string> {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const accounts = [
    ...new Set([
      ...read.wallets.map(({ account }) => account),
      ...read.trades.map(({ account }) => account),
      ...read.overflows.map(({ account }) => account),
    ]),
  ];
  if (accounts.length === 0) {
    return new Set();
  }
  const rows = execute(
    kysely
      .selectFrom("tracked_wallets")
      .select("account")
      .where("untracked_at", "is", null)
      .where("account", "in", accounts),
  ).rows;
  return new Set(rows.map(({ account }) => account));
}

function storeTrades(
  database: DatabaseSync,
  read: LeaderReadRecord,
  live: ReadonlySet<string>,
): readonly StoredActivity[] {
  const { kysely, execute, takeFirst } = createSyncKysely<EngineTables>(database);
  return read.trades.flatMap((trade) => {
    if (!live.has(trade.account)) {
      return [];
    }
    const inserted = execute(
      kysely
        .insertInto("wallet_activity")
        .values(activityRowOf(trade))
        .onConflict((conflict) =>
          conflict.columns(["account", "tx_hash", "log_index"]).doNothing(),
        ),
    );
    if (inserted.numAffectedRows !== 1n) {
      return [];
    }
    const row = takeFirst(
      kysely
        .selectFrom("wallet_activity")
        .selectAll()
        .where("account", "=", trade.account)
        .where("tx_hash", "=", trade.txHash)
        .where("log_index", "=", trade.logIndex),
    );
    return row === undefined ? [] : [toStoredActivity(row)];
  });
}

function moveWallets(
  database: DatabaseSync,
  read: LeaderReadRecord,
  live: ReadonlySet<string>,
): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const to = decimalText(read.to);
  for (const { account, sinceBlock, readFrom } of read.wallets) {
    if (live.has(account) && read.to >= readFrom) {
      execute(
        kysely
          .updateTable("tracked_wallets")
          .set((row) => ({
            since_block: row.fn.coalesce("since_block", row.val(decimalText(sinceBlock))),
            last_block: to,
          }))
          .where("account", "=", account),
      );
    }
  }
  for (const { account } of read.overflows) {
    if (live.has(account)) {
      execute(
        kysely
          .updateTable("tracked_wallets")
          .set((row) => ({ overflow_blocks: row("overflow_blocks", "+", 1) }))
          .where("account", "=", account),
      );
    }
  }
}

/** Stores one read of the leader watcher in one write, and answers the trades stored new. */
export const recordLeaderReadTask: StoreTask<LeaderReadRecord, readonly StoredActivity[]> =
  defineTask({
    name: "leaders.record",
    access: "write",
    input: leaderReadRecordSchema,
    output: z.array(storedActivitySchema),
    run(database, read) {
      const live = liveAccounts(database, read);
      const stored = storeTrades(database, read, live);
      moveWallets(database, read, live);
      writeWatchCursor(database, watcher, read);
      return stored;
    },
  });

/** The tracked wallets whose cut blocks are due to be told, marked told in the same write. */
export const overflowsToTellTask: StoreTask<OverflowQuery, readonly OverflowToTell[]> = defineTask({
  name: "leaders.overflowsToTell",
  access: "write",
  input: overflowQuerySchema,
  output: z.array(overflowToTellSchema),
  run(database, { atMs, everyMs, limit }) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const due = execute(
      kysely
        .selectFrom("tracked_wallets")
        .selectAll()
        .where("untracked_at", "is", null)
        .whereRef("overflow_blocks", ">", "overflow_told_blocks")
        .where((where) =>
          where.or([
            where("overflow_told_at", "is", null),
            where("overflow_told_at", "<=", atMs - everyMs),
          ]),
        )
        .orderBy("account")
        .limit(limit),
    ).rows;
    return due.map((row) => {
      const told = { overflow_told_blocks: row.overflow_blocks, overflow_told_at: atMs };
      execute(kysely.updateTable("tracked_wallets").set(told).where("account", "=", row.account));
      const blocks = row.overflow_blocks - row.overflow_told_blocks;
      return overflowToTellSchema.parse({ account: row.account, blocks });
    });
  },
});

/** One account's stored trades, newest first. */
export const walletActivityTask: StoreTask<ActivityQuery, readonly StoredActivity[]> = defineTask({
  name: "leaders.activity",
  access: "read",
  input: activityQuerySchema,
  output: z.array(storedActivitySchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const { account, fromMs, toMs, before } = query;
    const own = kysely.selectFrom("wallet_activity").selectAll().where("account", "=", account);
    const after = fromMs === undefined ? own : own.where("at", ">=", fromMs);
    const until = toMs === undefined ? after : after.where("at", "<=", toMs);
    const paged =
      before === undefined
        ? until
        : until.where((where) =>
            where.or([
              where("at", "<", before.atMs),
              where.and([where("at", "=", before.atMs), where("id", "<", before.id)]),
            ]),
          );
    const ordered = paged.orderBy("at", "desc").orderBy("id", "desc").limit(query.limit);
    return execute(ordered).rows.map(toStoredActivity);
  },
});

/** One account's trades stored after a given one, in the order they were stored. */
export const walletActivitySinceTask: StoreTask<ActivitySinceQuery, readonly StoredActivity[]> =
  defineTask({
    name: "leaders.activitySince",
    access: "read",
    input: activitySinceQuerySchema,
    output: z.array(storedActivitySchema),
    run(database, query) {
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const { account, afterId, fromMs } = query;
      const own = kysely
        .selectFrom("wallet_activity")
        .selectAll()
        .where("account", "=", account)
        .where("id", ">", afterId);
      const recent = fromMs === undefined ? own : own.where("at", ">=", fromMs);
      return execute(recent.orderBy("id").limit(query.limit)).rows.map(toStoredActivity);
    },
  });
