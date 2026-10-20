import type { DailySummaryStore } from "@binference/engine/notices";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { claimDailySummaryTask, latestDailySummaryTask } from "./daily-summary-tasks.js";

/** Every task of the SQLite daily summary store. */
export const dailySummaryTasks: readonly TaskRunner[] = [
  claimDailySummaryTask,
  latestDailySummaryTask,
];

/** The {@link DailySummaryStore} on `engine.sqlite`: one row of `daily_summaries` per agent and date. */
export function createSqliteDailySummaryStore(host: StoreHost): DailySummaryStore {
  return {
    claim: bindTask(host, claimDailySummaryTask),
    latest: bindTask(host, latestDailySummaryTask),
  };
}
