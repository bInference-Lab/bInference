import type { IntentStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
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
  return {
    create: bindTask(host, createIntentTask),
    get: bindTask(host, getIntentTask),
    transition: bindTask(host, moveIntentTask),
    freeze: bindTask(host, freezeTask),
    list: bindTask(host, listIntentsTask),
    events: bindTask(host, intentEventsTask),
    cards: bindTask(host, intentCardsTask),
    confirmation: bindTask(host, intentConfirmationTask),
    cardByRef: bindTask(host, cardByRefTask),
  };
}
