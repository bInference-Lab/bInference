import type { TrackedWalletStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  overflowsToTellTask,
  recordLeaderReadTask,
  trackedWalletsTask,
  walletActivityTask,
  watchCursorTask,
} from "./leader-tasks.js";

/** The tracked wallet store's tasks, which `engine.sqlite`'s workers serve. */
export const leaderTasks: readonly TaskRunner[] = [
  trackedWalletsTask,
  watchCursorTask,
  recordLeaderReadTask,
  overflowsToTellTask,
  walletActivityTask,
];

/** The {@link TrackedWalletStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteTrackedWalletStore(host: StoreHost): TrackedWalletStore {
  return {
    tracked: bindTask(host, trackedWalletsTask),
    cursor: bindTask(host, watchCursorTask),
    record: bindTask(host, recordLeaderReadTask),
    overflowsToTell: bindTask(host, overflowsToTellTask),
    activity: bindTask(host, walletActivityTask),
  };
}
