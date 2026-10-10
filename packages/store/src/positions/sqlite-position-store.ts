import type { PositionStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { recordDeparturesTask, resetPaperTask } from "./departure-tasks.js";
import {
  listArrivalsTask,
  listExecutionsTask,
  listPositionsTask,
  recordArrivalTask,
  recordExecutionTask,
} from "./position-tasks.js";

/** Every task of the SQLite position store. */
export const positionTasks: readonly TaskRunner[] = [
  listPositionsTask,
  recordExecutionTask,
  listExecutionsTask,
  recordArrivalTask,
  listArrivalsTask,
  recordDeparturesTask,
  resetPaperTask,
];

/**
 * The {@link PositionStore} on `engine.sqlite`'s `executions`, `arrivals`, `departures` and
 * `positions`: each call runs one store task, and the one writer stores an execution, an arrival,
 * an intent's departures or a paper reset in one transaction with the positions it moves, each
 * from the row version it was computed from.
 */
export function createSqlitePositionStore(host: StoreHost): PositionStore {
  return {
    positions: bindTask(host, listPositionsTask),
    record: bindTask(host, recordExecutionTask),
    executions: bindTask(host, listExecutionsTask),
    recordArrival: bindTask(host, recordArrivalTask),
    arrivals: bindTask(host, listArrivalsTask),
    recordDepartures: bindTask(host, recordDeparturesTask),
    resetPaper: bindTask(host, resetPaperTask),
  };
}
