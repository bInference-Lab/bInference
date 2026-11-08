import type { HelperStore } from "../ports.js";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { getHelperTask, listHelpersTask, moveHelperTask, startHelperTask } from "./helper-tasks.js";

/** The {@link HelperStore} on `agent.sqlite`: each call runs one store task. */
export function createSqliteHelperStore(host: StoreHost): HelperStore {
  return {
    start: bindTask(host, startHelperTask),
    get: bindTask(host, getHelperTask),
    list: bindTask(host, listHelpersTask),
    move: bindTask(host, moveHelperTask),
  };
}
