import type { ChainRef } from "@binference/chain";
import {
  creatorWindowMs,
  type LaunchQuery,
  launchQuerySchema,
  type LaunchReadRecord,
  launchReadRecordSchema,
  launchKeepMs,
  type StoredLaunch,
  storedLaunchSchema,
} from "@binference/engine/market";
import type { WatchCursorRecord } from "@binference/engine/orders";
import type { Expression, ExpressionBuilder, Kysely, SqlBool } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { StoreConnection } from "../dialect/store-connection.js";
import { createSyncKysely, type SyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { watchCursorTaskOf, writeWatchCursor } from "../watching/watch-cursor-rows.js";
import { launchRowOf, toStoredLaunch } from "./launch-rows.js";

// The launch feed's row in `watch_cursors`.
const watcher = "launches";

type LaunchesBuilder = ExpressionBuilder<EngineTables, "launches">;

// The forms a launch query takes from its connection's dialect: blocks are decimal text on SQLite
// and numeric on Postgres, and insiders a JSON array's text.
type LaunchForms = Pick<SyncKysely<EngineTables>, "decimalNumber" | "jsonArrayLength">;

// How many launches the row's creator made in the 30 days before it: earlier by time, or at the
// same time earlier in the chain.
function priorLaunches(eb: LaunchesBuilder, { decimalNumber }: LaunchForms) {
  return eb
    .selectFrom("launches as prior")
    .select((prior) => prior.fn.countAll<number>().as("count"))
    .whereRef("prior.creator", "=", "launches.creator")
    .where((prior) => {
      const at = prior.ref("launches.launched_at");
      const priorBlock = decimalNumber(prior.ref("prior.block"));
      const ownBlock = decimalNumber(prior.ref("launches.block"));
      return prior.and([
        prior("prior.launched_at", ">=", prior(at, "-", creatorWindowMs)),
        prior.or([
          prior("prior.launched_at", "<", at),
          prior.and([
            prior("prior.launched_at", "=", at),
            prior.or([
              prior(priorBlock, "<", ownBlock),
              prior.and([
                prior(priorBlock, "=", ownBlock),
                prior("prior.log_index", "<", prior.ref("launches.log_index")),
              ]),
            ]),
          ]),
        ]),
      ]);
    });
}

function withCounts(kysely: Kysely<EngineTables>, forms: LaunchForms) {
  return kysely
    .selectFrom("launches")
    .selectAll("launches")
    .select((eb) => priorLaunches(eb, forms).as("creator_launches"));
}

// Where the page is: launched at or after `fromMs`, and before `before`.
function pageConditions(
  eb: LaunchesBuilder,
  query: LaunchQuery,
  { decimalNumber }: LaunchForms,
): Expression<SqlBool>[] {
  const { fromMs, before } = query;
  const conditions = [eb("launches.chain", "=", query.chain)];
  if (fromMs !== undefined) {
    conditions.push(eb("launches.launched_at", ">=", fromMs));
  }
  if (before !== undefined) {
    const block = decimalNumber(eb.ref("launches.block"));
    const beforeBlock = decimalNumber(eb.val(decimalText(before.block)));
    const at = before.launchedAtMs;
    conditions.push(
      eb.or([
        eb("launches.launched_at", "<", at),
        eb.and([
          eb("launches.launched_at", "=", at),
          eb.or([
            eb(block, "<", beforeBlock),
            eb.and([eb(block, "=", beforeBlock), eb("launches.log_index", "<", before.logIndex)]),
          ]),
        ]),
      ]),
    );
  }
  return conditions;
}

// The filters on what the launch is: its launchpad, quote token and curve.
function placeConditions(eb: LaunchesBuilder, query: LaunchQuery): Expression<SqlBool>[] {
  const filters = query.filters ?? {};
  const { launchpads, quoteTokens, minCurveProgressBps: least } = filters;
  return [
    ...(launchpads === undefined ? [] : [eb("launches.launchpad", "in", launchpads)]),
    ...(quoteTokens === undefined ? [] : [eb("launches.quote_token", "in", quoteTokens)]),
    ...(least === undefined
      ? []
      : [
          eb.or([eb("launches.graduated", "=", 1), eb("launches.curve_progress_bps", ">=", least)]),
        ]),
  ];
}

// The bounds on its taxes, insiders and creator's launches: an unread value meets none.
function boundConditions(
  eb: LaunchesBuilder,
  query: LaunchQuery,
  forms: LaunchForms,
): Expression<SqlBool>[] {
  const { maxTaxBps, maxSnipeTaxBps, maxInsiders, maxCreatorLaunches30d } = query.filters ?? {};
  const insiders = forms.jsonArrayLength("launches.insiders");
  return [
    ...(maxTaxBps === undefined ? [] : [eb("launches.tax_bps", "<=", maxTaxBps)]),
    ...(maxSnipeTaxBps === undefined ? [] : [eb("launches.snipe_tax_bps", "<=", maxSnipeTaxBps)]),
    ...(maxInsiders === undefined ? [] : [eb(insiders, "<=", maxInsiders)]),
    ...(maxCreatorLaunches30d === undefined
      ? []
      : [eb(priorLaunches(eb, forms), "<=", maxCreatorLaunches30d)]),
  ];
}

/** The launch feed's cursor on a chain. */
export const launchCursorTask: StoreTask<ChainRef, WatchCursorRecord | undefined> =
  watchCursorTaskOf("launches.cursor", watcher);

// Each block of the read, as its column stores it.
function blocksOf(read: LaunchReadRecord): readonly string[] {
  const blocks: string[] = [];
  for (let block = read.from; block <= read.to; block += 1n) {
    blocks.push(decimalText(block));
  }
  return blocks;
}

// Deletes the launches of the read's blocks it no longer holds, and the chain's past 90 days.
function forget(database: StoreConnection, read: LaunchReadRecord): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const held = read.launches.map(({ token }) => token);
  const inSpan = kysely
    .deleteFrom("launches")
    .where("chain", "=", read.chain)
    .where("block", "in", blocksOf(read));
  execute(held.length === 0 ? inSpan : inSpan.where("token", "not in", held));
  execute(
    kysely
      .deleteFrom("launches")
      .where("chain", "=", read.chain)
      .where("launched_at", "<", read.atMs - launchKeepMs),
  );
}

// Stores each launch new, or moves a stored one to where the read found it; answers the new.
function store(database: StoreConnection, read: LaunchReadRecord): readonly string[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  return read.launches.flatMap((launch) => {
    const row = launchRowOf(read.chain, launch, read.atMs);
    const inserted = execute(
      kysely
        .insertInto("launches")
        .values(row)
        .onConflict((conflict) => conflict.columns(["chain", "token"]).doNothing()),
    );
    if (inserted.numAffectedRows === 1n) {
      return [launch.token];
    }
    const { block, block_hash, tx_hash, log_index, launched_at } = row;
    const place = { block, block_hash, tx_hash, log_index, launched_at };
    execute(
      kysely
        .updateTable("launches")
        .set(place)
        .where("chain", "=", read.chain)
        .where("token", "=", launch.token),
    );
    return [];
  });
}

function change(database: StoreConnection, read: LaunchReadRecord): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  for (const { token, curveProgressBps, graduated } of read.changes) {
    const set = {
      changed_at: read.atMs,
      ...(curveProgressBps === undefined ? {} : { curve_progress_bps: curveProgressBps }),
      ...(graduated === true ? { graduated: 1 } : {}),
    };
    execute(
      kysely
        .updateTable("launches")
        .set(set)
        .where("chain", "=", read.chain)
        .where("token", "=", token),
    );
  }
}

/** Stores one read of the launch feed in one write, and answers the launches stored new. */
export const recordLaunchReadTask: StoreTask<LaunchReadRecord, readonly StoredLaunch[]> =
  defineTask({
    name: "launches.record",
    access: "write",
    input: launchReadRecordSchema,
    output: z.array(storedLaunchSchema),
    run(database, read) {
      const { kysely, execute, ...forms } = createSyncKysely<EngineTables>(database);
      forget(database, read);
      const added = store(database, read);
      change(database, read);
      writeWatchCursor(database, watcher, read);
      if (added.length === 0) {
        return [];
      }
      const rows = execute(
        withCounts(kysely, forms)
          .where("launches.chain", "=", read.chain)
          .where("launches.token", "in", added),
      ).rows.map((row) => toStoredLaunch({ ...row, creator_launches: row.creator_launches ?? 0 }));
      return added.flatMap((token) => rows.filter((row) => row.token === token));
    },
  });

/** A chain's launches the query asks for, newest first. */
export const listLaunchesTask: StoreTask<LaunchQuery, readonly StoredLaunch[]> = defineTask({
  name: "launches.list",
  access: "read",
  input: launchQuerySchema,
  output: z.array(storedLaunchSchema),
  run(database, query) {
    const { kysely, execute, ...forms } = createSyncKysely<EngineTables>(database);
    const listed = withCounts(kysely, forms)
      .where((eb) =>
        eb.and([
          ...pageConditions(eb, query, forms),
          ...placeConditions(eb, query),
          ...boundConditions(eb, query, forms),
        ]),
      )
      .orderBy("launches.launched_at", "desc")
      .orderBy((eb) => forms.decimalNumber(eb.ref("launches.block")), "desc")
      .orderBy("launches.log_index", "desc")
      .limit(query.limit);
    return execute(listed).rows.map((row) =>
      toStoredLaunch({ ...row, creator_launches: row.creator_launches ?? 0 }),
    );
  },
});
