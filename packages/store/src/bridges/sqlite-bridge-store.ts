import type { BridgeStore } from "@binference/engine/sends";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  getBridgeTask,
  listBridgesTask,
  moveBridgeTask,
  openBridgeTask,
  settledByTask,
} from "./bridge-tasks.js";

/** Every task of the SQLite bridge store. */
export const bridgeTasks: readonly TaskRunner[] = [
  openBridgeTask,
  getBridgeTask,
  listBridgesTask,
  settledByTask,
  moveBridgeTask,
];

/** The {@link BridgeStore} on `engine.sqlite`: one row of `bridges` per bridge intent. */
export function createSqliteBridgeStore(host: StoreHost): BridgeStore {
  return {
    open: bindTask(host, openBridgeTask),
    get: bindTask(host, getBridgeTask),
    list: bindTask(host, listBridgesTask),
    settledBy: bindTask(host, settledByTask),
    move: bindTask(host, moveBridgeTask),
  };
}
