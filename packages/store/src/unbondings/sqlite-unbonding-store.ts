import type { UnbondingStore } from "@binference/engine/sends";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import {
  claimedUnbondingsTask,
  claimUnbondingsTask,
  closeOutsideUnbondingTask,
  listOpenUnbondingsTask,
  markToldUnbondingsTask,
  openUnbondingsOfTask,
  openUnbondingTask,
  untoldReadyUnbondingsTask,
} from "./unbonding-tasks.js";

/** Every task of the SQLite unbonding store. */
export const unbondingTasks: readonly TaskRunner[] = [
  openUnbondingTask,
  listOpenUnbondingsTask,
  openUnbondingsOfTask,
  claimedUnbondingsTask,
  claimUnbondingsTask,
  untoldReadyUnbondingsTask,
  markToldUnbondingsTask,
  closeOutsideUnbondingTask,
];

/** The {@link UnbondingStore} on `engine.sqlite`: one row of `stake_unbondings` per unstake. */
export function createSqliteUnbondingStore(host: StoreHost): UnbondingStore {
  return {
    open: bindTask(host, openUnbondingTask),
    listOpen: bindTask(host, listOpenUnbondingsTask),
    openOf: bindTask(host, openUnbondingsOfTask),
    claimedBy: bindTask(host, claimedUnbondingsTask),
    claim: bindTask(host, claimUnbondingsTask),
    untoldReady: bindTask(host, untoldReadyUnbondingsTask),
    closeOutside: bindTask(host, closeOutsideUnbondingTask),
    markTold: async (told, call) => {
      await bindTask(host, markToldUnbondingsTask)(told, call);
    },
  };
}
