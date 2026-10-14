import type { IntentStore } from "@binference/engine";
import { newestAssetInfos } from "@binference/engine/surfaces";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { confirmedSinceTask, recordLandedLateTask } from "./confirmed-tasks.js";
import { fillsInFlightTask } from "./fills-in-flight-task.js";
import {
  assetDocumentsTask,
  cardByRefTask,
  createIntentTask,
  freezeTask,
  getIntentTask,
  intentCardsTask,
  intentConfirmationTask,
  intentEventsTask,
  listIntentsTask,
  moveIntentTask,
} from "./intent-tasks.js";

/**
 * The {@link IntentStore} on `engine.sqlite`: each call runs one store task, and each write runs
 * in one transaction with its event, ledger entry and card writes; a freeze writes its agents and
 * every move in one.
 */
export function createSqliteIntentStore(host: StoreHost): IntentStore {
  const assetDocuments = bindTask(host, assetDocumentsTask);
  return {
    storedAssets: async (assets, call) =>
      newestAssetInfos(await assetDocuments(assets, call), assets),
    create: bindTask(host, createIntentTask),
    get: bindTask(host, getIntentTask),
    transition: bindTask(host, moveIntentTask),
    freeze: bindTask(host, freezeTask),
    list: bindTask(host, listIntentsTask),
    fillsInFlight: bindTask(host, fillsInFlightTask),
    confirmedSince: bindTask(host, confirmedSinceTask),
    recordLandedLate: bindTask(host, recordLandedLateTask),
    events: bindTask(host, intentEventsTask),
    cards: bindTask(host, intentCardsTask),
    confirmation: bindTask(host, intentConfirmationTask),
    cardByRef: bindTask(host, cardByRefTask),
  };
}
