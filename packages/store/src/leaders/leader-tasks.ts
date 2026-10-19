import type { DatabaseSync } from "node:sqlite";
import { type ChainRef, chainRefSchema } from "@binference/chain";
import {
  type ActivityQuery,
  activityQuerySchema,
  type LeaderReadRecord,
  leaderReadRecordSchema,
  type StoredActivity,
  storedActivitySchema,
  type TrackedWalletRecord,
  trackedWalletRecordSchema,
  type WatchCursorRecord,
  watchCursorRecordSchema,
} from "@binference/engine/orders";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { activityRowOf, toStoredActivity, toTrackedWallet } from "./leader-rows.js";
import { namedAccounts } from "./tracked-sync.js";

// The leader watcher's row in `watch_cursors`.
const watcher = "wallets";

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
export const watchCursorTask: StoreTask<ChainRef, WatchCursorRecord | undefined> = defineTask({
  name: "leaders.cursor",
  access: "read",
  input: chainRefSchema,
  output: watchCursorRecordSchema.optional(),
  run(database, chain) {
    const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
    const row = takeFirst(
      kysely
        .selectFrom("watch_cursors")
        .selectAll()
        .where("watcher", "=", watcher)
        .where("chain", "=", chain),
    );
    return row === undefined
      ? undefined
      : watchCursorRecordSchema.parse({
          chain: row.chain,
          block: row.block,
          blockHash: row.block_hash,
          atMs: row.at,
        });
  },
});

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
      const { kysely, execute } = createSyncKysely<EngineTables>(database);
      const live = liveAccounts(database, read);
      const stored = storeTrades(database, read, live);
      moveWallets(database, read, live);
      const cursor = { block: decimalText(read.to), block_hash: read.toHash, at: read.atMs };
      execute(
        kysely
          .insertInto("watch_cursors")
          .values({ watcher, chain: read.chain, ...cursor })
          .onConflict((conflict) => conflict.columns(["watcher", "chain"]).doUpdateSet(cursor)),
      );
      return stored;
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
