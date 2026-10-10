import type { DatabaseSync } from "node:sqlite";
import { err, ok, type Result } from "@binference/core";
import {
  type ArrivalRecord,
  arrivalRecordSchema,
  type PaperReset,
  paperResetSchema,
} from "@binference/engine";
import {
  type DepartureDraft,
  type DepartureOutcome,
  type DepartureRecord,
  departureRecordSchema,
  type DepartureWrite,
  departureWriteSchema,
} from "@binference/engine/sends";
import type { Insertable, Selectable } from "kysely";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import type { DeparturesTable } from "../databases/position-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { decimalText } from "../rows/column-values.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import { arrivalRow, movePositions, positionConstraint } from "./position-rows.js";

function departureRow(
  intentId: DepartureWrite["intentId"],
  draft: DepartureDraft,
): Insertable<DeparturesTable> {
  return {
    intent_id: intentId,
    wallet_id: draft.walletId,
    asset: draft.sent.asset,
    amount: decimalText(draft.sent.base),
    gas_asset: draft.gas.asset,
    gas_amount: decimalText(draft.gas.base),
    tx_hash: draft.txHash,
    at: draft.atMs,
  };
}

function toDepartureRecord(row: Selectable<DeparturesTable>): DepartureRecord {
  return departureRecordSchema.parse({
    id: row.id,
    intentId: row.intent_id,
    walletId: row.wallet_id,
    atMs: row.at,
    sent: { asset: row.asset, base: row.amount },
    gas: { asset: row.gas_asset, base: row.gas_amount },
    txHash: row.tx_hash,
  });
}

function storedDepartures(database: DatabaseSync, write: DepartureWrite): DepartureRecord[] {
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const query = kysely
    .selectFrom("departures")
    .selectAll()
    .where("intent_id", "=", write.intentId)
    .orderBy("id");
  return execute(query).rows.map(toDepartureRecord);
}

/**
 * Stores one intent's departures with their live position writes, once: an intent that has
 * departures already gets those back and nothing is written.
 */
export const recordDeparturesTask: StoreTask<DepartureWrite, DepartureOutcome> = defineTask({
  name: "positions.record_departures",
  access: "write",
  input: departureWriteSchema,
  output: resultSchema(z.array(departureRecordSchema), ["stale"]),
  run(database, write) {
    const earlier = storedDepartures(database, write);
    if (earlier.length > 0) {
      return ok(earlier);
    }
    if (write.positions.some(({ position }) => position.isPaper)) {
      throw positionConstraint("A departure moves only live positions.");
    }
    if (!movePositions(database, write.positions)) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = write.departures.map((draft) => departureRow(write.intentId, draft));
    execute(kysely.insertInto("departures").values(rows));
    return ok(storedDepartures(database, write));
  },
});

// A reset writes only its wallet's paper rows, and every paper position the wallet holds: one it
// leaves out moved since the reset read the positions.
function isWhole(database: DatabaseSync, reset: PaperReset): boolean {
  const isOwn = (key: { readonly walletId: string; readonly isPaper: boolean }): boolean =>
    key.walletId === reset.walletId && key.isPaper;
  if (!reset.arrivals.every(isOwn) || !reset.positions.every(({ position }) => isOwn(position))) {
    throw positionConstraint("A paper reset changes only its wallet's paper rows.");
  }
  const written = new Set<string>(reset.positions.map(({ position }) => position.asset));
  const { kysely, execute } = createSyncKysely<EngineTables>(database);
  const held = execute(
    kysely
      .selectFrom("positions")
      .select("asset")
      .where("wallet_id", "=", reset.walletId)
      .where("paper", "=", 1),
  ).rows;
  return held.every(({ asset }) => written.has(asset));
}

/** Starts a wallet's paper portfolio again, all or nothing, and numbers its arrivals. */
export const resetPaperTask: StoreTask<
  PaperReset,
  Result<readonly ArrivalRecord[], "stale">
> = defineTask({
  name: "positions.reset_paper",
  access: "write",
  input: paperResetSchema,
  output: resultSchema(z.array(arrivalRecordSchema), ["stale"]),
  run(database, reset) {
    if (!isWhole(database, reset) || !movePositions(database, reset.positions)) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    return ok(
      reset.arrivals.map((arrival) => {
        const inserted = execute(kysely.insertInto("arrivals").values(arrivalRow(arrival)));
        return { ...arrival, id: Number(inserted.insertId) };
      }),
    );
  },
});
