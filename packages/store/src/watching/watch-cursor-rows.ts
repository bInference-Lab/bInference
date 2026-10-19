import type { DatabaseSync } from "node:sqlite";
import { type ChainRef, chainRefSchema } from "@binference/chain";
import { type WatchCursorRecord, watchCursorRecordSchema } from "@binference/engine/orders";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";

/** A log watcher's row in `watch_cursors`: the leader watcher's or the launch feed's. */
export type CursorWatcher = "wallets" | "launches";

// Where a log watcher of a chain stopped, if it stored a cursor.
function readWatchCursor(
  database: DatabaseSync,
  watcher: CursorWatcher,
  chain: ChainRef,
): WatchCursorRecord | undefined {
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
}

/** Moves a log watcher's cursor on a chain to the last block of a read, inside its write. */
export function writeWatchCursor(
  database: DatabaseSync,
  watcher: CursorWatcher,
  read: {
    readonly chain: ChainRef;
    readonly to: bigint;
    readonly toHash: string;
    readonly atMs: number;
  },
): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const cursor = { block: decimalText(read.to), block_hash: read.toHash, at: read.atMs };
  execute(
    kysely
      .insertInto("watch_cursors")
      .values({ watcher, chain: read.chain, ...cursor })
      .onConflict((conflict) => conflict.columns(["watcher", "chain"]).doUpdateSet(cursor)),
  );
}

/** The task that reads where a log watcher of a chain stopped. */
export function watchCursorTaskOf(
  name: string,
  watcher: CursorWatcher,
): StoreTask<ChainRef, WatchCursorRecord | undefined> {
  return defineTask({
    name,
    access: "read",
    input: chainRefSchema,
    output: watchCursorRecordSchema.optional(),
    run: (database, chain) => readWatchCursor(database, watcher, chain),
  });
}
