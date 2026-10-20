import type { AliveStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { lastAliveTask, markAliveTask } from "./alive-tasks.js";

/** Every task of the SQLite alive store. */
export const aliveTasks: readonly TaskRunner[] = [lastAliveTask, markAliveTask];

/**
 * The {@link AliveStore} on `engine.sqlite`: the one row of `engine_alive`, so a start reads when
 * the engine last ran (decision 0266).
 */
export function createSqliteAliveStore(host: StoreHost): AliveStore {
  const last = bindTask(host, lastAliveTask);
  const mark = bindTask(host, markAliveTask);
  return {
    lastAlive: async (options) => (await last(null, options)) ?? undefined,
    markAlive: async (atMs, options) => {
      await mark(atMs, options);
    },
  };
}
