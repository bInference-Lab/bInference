import type { ShellStore } from "@binference/engine/shell";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  allowTask,
  disallowTask,
  listAllowedTask,
  listWatchesTask,
  unwatchTask,
  watchTask,
} from "./shell-tasks.js";

/** Every task of the SQLite shell store. */
export const shellTasks: readonly TaskRunner[] = [
  listAllowedTask,
  allowTask,
  disallowTask,
  watchTask,
  unwatchTask,
  listWatchesTask,
];

/**
 * The {@link ShellStore} on `engine.sqlite` (decision 0409): `shell_allowed`, one row per program,
 * arguments and folder, read in the order they were kept, and `shell_watches`, one row per job.
 */
export function createSqliteShellStore(host: StoreHost): ShellStore {
  const allowed = bindTask(host, listAllowedTask);
  const allow = bindTask(host, allowTask);
  const disallow = bindTask(host, disallowTask);
  const watch = bindTask(host, watchTask);
  const unwatch = bindTask(host, unwatchTask);
  const watched = bindTask(host, listWatchesTask);
  return {
    allowed: async (options) => allowed(null, options),
    allow: async (commands, options) => allow(commands, options),
    disallow: async (id, options) => (await disallow(id, options)) ?? undefined,
    watch: async (record, options) => {
      await watch(record, options);
    },
    unwatch: async (job, options) => unwatch(job, options),
    watched: async (options) => watched(null, options),
  };
}
