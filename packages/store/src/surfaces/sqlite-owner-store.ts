import type { OwnerStore } from "@binference/engine/surfaces";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { bindOwnerTask, getOwnerTask } from "./owner-tasks.js";

/** Every task of the SQLite owner store. */
export const ownerTasks: readonly TaskRunner[] = [getOwnerTask, bindOwnerTask];

/**
 * The {@link OwnerStore} on `engine.sqlite`: the one row of `telegram_owner`, so the owner's bot
 * stays paired across restarts (decision 0139).
 */
export function createSqliteOwnerStore(host: StoreHost): OwnerStore {
  const get = bindTask(host, getOwnerTask);
  const bind = bindTask(host, bindOwnerTask);
  return {
    get: async (options) => (await get(null, options)) ?? undefined,
    bind: async (binding, options) => (await bind(binding, options)) ?? undefined,
  };
}
