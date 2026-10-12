import type { ModelUsageStore } from "@binference/engine/chat";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  claimBudgetNoticeTask,
  modelSpendTask,
  recordModelUsageTask,
} from "./model-usage-tasks.js";

/** Every task of the SQLite model usage store. */
export const modelUsageTasks: readonly TaskRunner[] = [
  recordModelUsageTask,
  modelSpendTask,
  claimBudgetNoticeTask,
];

/**
 * The {@link ModelUsageStore} on `engine.sqlite`: one row of `model_usage` for each attempt's key,
 * and one row of `budget_notices` for each agent's day whose budget the owner was told is spent.
 */
export function createSqliteModelUsageStore(host: StoreHost): ModelUsageStore {
  const record = bindTask(host, recordModelUsageTask);
  const spent = bindTask(host, modelSpendTask);
  const claim = bindTask(host, claimBudgetNoticeTask);
  return {
    record: async (charge, options) => ((await record(charge, options)) ? "recorded" : "exists"),
    spent: async (query, options) => spent(query, options),
    claimBudgetNotice: async (notice, options) => claim(notice, options),
  };
}
