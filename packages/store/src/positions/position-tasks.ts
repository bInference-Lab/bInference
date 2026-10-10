import { err, ok, type Result } from "@binference/core";
import {
  type ArrivalRecord,
  arrivalRecordSchema,
  type ArrivalWrite,
  arrivalWriteSchema,
  type ExecutionQuery,
  executionQuerySchema,
  type ExecutionRecord,
  executionRecordSchema,
  type ExecutionWrite,
  executionWriteSchema,
  type PositionQuery,
  positionQuerySchema,
  type PositionRecord,
  positionRecordSchema,
} from "@binference/engine";
import { z } from "zod";
import type { EngineTables } from "../databases/engine-tables.js";
import { createSyncKysely } from "../dialect/sync-kysely.js";
import { resultSchema } from "../tasks/result-schema.js";
import { defineTask, type StoreTask } from "../tasks/store-task.js";
import {
  arrivalRow,
  executionRow,
  listArrivals,
  listExecutions,
  movePositions,
  toPositionRecord,
} from "./position-rows.js";

/** Lists one wallet's paper or live positions, by asset. */
export const listPositionsTask: StoreTask<PositionQuery, readonly PositionRecord[]> = defineTask({
  name: "positions.list",
  access: "read",
  input: positionQuerySchema,
  output: z.array(positionRecordSchema),
  run(database, query) {
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const rows = execute(
      kysely
        .selectFrom("positions")
        .selectAll()
        .where("wallet_id", "=", query.walletId)
        .where("paper", "=", query.isPaper ? 1 : 0)
        .orderBy("asset"),
    ).rows;
    return rows.map(toPositionRecord);
  },
});

/** Stores an execution with its position writes, or nothing when a position moved first. */
export const recordExecutionTask: StoreTask<
  ExecutionWrite,
  Result<ExecutionRecord, "stale">
> = defineTask({
  name: "positions.record_execution",
  access: "write",
  input: executionWriteSchema,
  output: resultSchema(executionRecordSchema, ["stale"]),
  run(database, write) {
    if (!movePositions(database, write.positions)) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const inserted = execute(kysely.insertInto("executions").values(executionRow(write.execution)));
    return ok({ ...write.execution, id: Number(inserted.insertId) });
  },
});

/** Lists the executions a query names, in the order recorded. */
export const listExecutionsTask: StoreTask<ExecutionQuery, readonly ExecutionRecord[]> = defineTask(
  {
    name: "positions.executions",
    access: "read",
    input: executionQuerySchema,
    output: z.array(executionRecordSchema),
    run: listExecutions,
  },
);

/** Stores an arrival with its position writes, or nothing when a position moved first. */
export const recordArrivalTask: StoreTask<
  ArrivalWrite,
  Result<ArrivalRecord, "stale">
> = defineTask({
  name: "positions.record_arrival",
  access: "write",
  input: arrivalWriteSchema,
  output: resultSchema(arrivalRecordSchema, ["stale"]),
  run(database, write) {
    if (!movePositions(database, write.positions)) {
      return err("stale");
    }
    const { kysely, execute } = createSyncKysely<EngineTables>(database);
    const inserted = execute(kysely.insertInto("arrivals").values(arrivalRow(write.arrival)));
    return ok({ ...write.arrival, id: Number(inserted.insertId) });
  },
});

/** Lists the arrivals a query names, in the order recorded. */
export const listArrivalsTask: StoreTask<ExecutionQuery, readonly ArrivalRecord[]> = defineTask({
  name: "positions.arrivals",
  access: "read",
  input: executionQuerySchema,
  output: z.array(arrivalRecordSchema),
  run: listArrivals,
});
