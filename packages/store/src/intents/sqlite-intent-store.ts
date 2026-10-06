import type { IntentStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  createIntentTask,
  getIntentTask,
  intentCardsTask,
  intentConfirmationTask,
  intentEventsTask,
  listIntentsTask,
  moveIntentTask,
} from "./intent-tasks.js";

/**
 * The {@link IntentStore} on `engine.sqlite`: each call runs one store task, and each write runs
 * in one transaction with its event, ledger entry and card writes.
 */
export function createSqliteIntentStore(host: StoreHost): IntentStore {
  return {
    create: bindTask(host, createIntentTask),
    get: bindTask(host, getIntentTask),
    transition: bindTask(host, moveIntentTask),
    list: bindTask(host, listIntentsTask),
    events: bindTask(host, intentEventsTask),
    cards: bindTask(host, intentCardsTask),
    confirmation: bindTask(host, intentConfirmationTask),
  };
}
