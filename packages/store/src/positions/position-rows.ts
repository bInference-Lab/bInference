import type { DatabaseSync } from "node:sqlite";
import { BinferenceError } from "@binference/core";
import {
  type ArrivalDraft,
  type ArrivalRecord,
  arrivalRecordSchema,
  type ExecutionWrite,
  type ExecutionQuery,
  type ExecutionRecord,
  executionRecordSchema,
  type PositionKey,
  type PositionRecord,
  positionRecordSchema,
  type PositionWrite,
} from "@binference/engine";
import type { Insertable, Selectable } from "kysely";
import type { EngineTables } from "../databases/engine-tables.js";
import type {
  ArrivalsTable,
  ExecutionsTable,
  PositionsTable,
} from "../databases/position-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText, field, orNull } from "../rows/column-values.js";

// Converts positions, executions and arrivals between their records and their rows (database
// spec, section 2.3): amounts as decimal text, a realized loss as text with its minus sign, and
// the paper flag as 0 or 1.

/** A fault for a write that breaks a rule of the position store; it rolls the task back. */
export function positionConstraint(message: string): BinferenceError {
  return new BinferenceError({ code: "store.constraint", message });
}

/** Reads a stored position row into its record. */
export function toPositionRecord(row: Selectable<PositionsTable>): PositionRecord {
  return positionRecordSchema.parse({
    walletId: row.wallet_id,
    asset: row.asset,
    isPaper: row.paper === 1,
    quantityBase: row.quantity,
    costUsdMicros: row.cost_usd_micros,
    realizedUsdMicros: row.realized_usd_micros,
    changedAtMs: row.changed_at,
    version: row.version,
  });
}

const keyText = (key: PositionKey): string => `${key.walletId} ${key.asset} ${String(key.isPaper)}`;

function readVersion(database: DatabaseSync, key: PositionKey): number | undefined {
  const { kysely, takeFirst } = createSyncKysely<EngineTables>(database);
  const row = takeFirst(
    kysely
      .selectFrom("positions")
      .select("version")
      .where("wallet_id", "=", key.walletId)
      .where("asset", "=", key.asset)
      .where("paper", "=", key.isPaper ? 1 : 0),
  );
  return row?.version;
}

function writeOne(database: DatabaseSync, { position, readVersion: read }: PositionWrite): void {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const columns = {
    quantity: decimalText(position.quantityBase),
    cost_usd_micros: decimalText(position.costUsdMicros),
    realized_usd_micros: position.realizedUsdMicros.toString(),
    changed_at: position.changedAtMs,
  };
  if (read === undefined) {
    const key = { wallet_id: position.walletId, asset: position.asset };
    execute(
      kysely
        .insertInto("positions")
        .values({ ...key, paper: position.isPaper ? 1 : 0, ...columns, version: 0 }),
    );
    return;
  }
  execute(
    kysely
      .updateTable("positions")
      .set({ ...columns, version: read + 1 })
      .where("wallet_id", "=", position.walletId)
      .where("asset", "=", position.asset)
      .where("paper", "=", position.isPaper ? 1 : 0)
      .where("version", "=", read),
  );
}

/**
 * Moves every position a write names, each from the row version it read (no version read: no
 * row), and answers `true`; or moves none and answers `false` when one row moved since. Two writes
 * to one position are a `store.constraint` fault. It runs inside the caller's write task.
 */
export function movePositions(database: DatabaseSync, writes: readonly PositionWrite[]): boolean {
  if (new Set(writes.map(({ position }) => keyText(position))).size < writes.length) {
    throw positionConstraint("One write moves the same position twice.");
  }
  if (!writes.every((write) => readVersion(database, write.position) === write.readVersion)) {
    return false;
  }
  writes.forEach((write) => {
    writeOne(database, write);
  });
  return true;
}

/** An execution as its row stores it, with what it realized. */
export function executionRow(write: ExecutionWrite): Insertable<ExecutionsTable> {
  const draft = write.execution;
  return {
    intent_id: draft.intentId,
    wallet_id: draft.walletId,
    asset_in: draft.sold.asset,
    amount_in: decimalText(draft.sold.base),
    fee_amount: decimalText(draft.feeBase),
    asset_out: draft.bought.asset,
    amount_out: decimalText(draft.bought.base),
    gas_asset: draft.gas.asset,
    gas_amount: decimalText(draft.gas.base),
    tx_hash: orNull(draft.txHash),
    value_usd_micros: decimalText(draft.valueUsdMicros),
    fee_usd_micros: decimalText(draft.feeUsdMicros),
    gas_usd_micros: decimalText(draft.gasUsdMicros),
    paper: draft.isPaper ? 1 : 0,
    at: draft.atMs,
    realized_usd_micros: write.realizedUsdMicros.toString(),
  };
}

// Reads a stored execution row into its record.
function toExecutionRecord(row: Selectable<ExecutionsTable>): ExecutionRecord {
  return executionRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    walletId: row.wallet_id,
    isPaper: row.paper === 1,
    atMs: row.at,
    sold: { asset: row.asset_in, base: row.amount_in },
    feeBase: row.fee_amount,
    bought: { asset: row.asset_out, base: row.amount_out },
    gas: { asset: row.gas_asset, base: row.gas_amount },
    ...field("txHash", row.tx_hash),
    valueUsdMicros: row.value_usd_micros,
    feeUsdMicros: row.fee_usd_micros,
    gasUsdMicros: row.gas_usd_micros,
    realizedUsdMicros: row.realized_usd_micros,
  });
}

/** An arrival draft as its row stores it. */
export function arrivalRow(draft: ArrivalDraft): Insertable<ArrivalsTable> {
  return {
    wallet_id: draft.walletId,
    asset: draft.received.asset,
    amount: decimalText(draft.received.base),
    value_usd_micros: draft.valueUsdMicros === undefined ? null : decimalText(draft.valueUsdMicros),
    tx_hash: orNull(draft.txHash),
    paper: draft.isPaper ? 1 : 0,
    at: draft.atMs,
  };
}

// Reads a stored arrival row into its record.
function toArrivalRecord(row: Selectable<ArrivalsTable>): ArrivalRecord {
  return arrivalRecordSchema.parse({
    id: row.id,
    walletId: row.wallet_id,
    isPaper: row.paper === 1,
    atMs: row.at,
    received: { asset: row.asset, base: row.amount },
    ...field("txHash", row.tx_hash),
    ...field("valueUsdMicros", row.value_usd_micros),
  });
}

// The numbers of the rows of `executions` or `arrivals` a query names: numbered after `after`, in
// the query's mode, of its wallet and time range when it names them, in the order recorded.
function listedIds(
  database: DatabaseSync,
  table: "executions" | "arrivals",
  query: ExecutionQuery,
): readonly number[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const page = kysely
    .selectFrom(table)
    .select("id")
    .where("id", ">", query.after)
    .where("paper", "=", query.isPaper ? 1 : 0);
  const { walletId, fromMs, toMs } = query;
  const owned = walletId === undefined ? page : page.where("wallet_id", "=", walletId);
  const after = fromMs === undefined ? owned : owned.where("at", ">=", fromMs);
  const within = toMs === undefined ? after : after.where("at", "<=", toMs);
  return execute(within.orderBy("id").limit(query.limit)).rows.map(({ id }) => id);
}

/** The executions a query names, in the order recorded. */
export function listExecutions(
  database: DatabaseSync,
  query: ExecutionQuery,
): readonly ExecutionRecord[] {
  const ids = listedIds(database, "executions", query);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const rows =
    ids.length === 0
      ? []
      : execute(kysely.selectFrom("executions").selectAll().where("id", "in", ids).orderBy("id"))
          .rows;
  return rows.map(toExecutionRecord);
}

/** The arrivals a query names, in the order recorded. */
export function listArrivals(
  database: DatabaseSync,
  query: ExecutionQuery,
): readonly ArrivalRecord[] {
  const ids = listedIds(database, "arrivals", query);
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const rows =
    ids.length === 0
      ? []
      : execute(kysely.selectFrom("arrivals").selectAll().where("id", "in", ids).orderBy("id"))
          .rows;
  return rows.map(toArrivalRecord);
}
