import type { OrderStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { copyBuysTask } from "./copy-buy-rows.js";
import {
  createOrderTask,
  getOrderTask,
  listOrderFillsTask,
  listOrdersTask,
  markAnnouncedTask,
  moveOrdersTask,
  orderByIntentTask,
  countedFillTask,
  recordLandedFillTask,
  recordOrderFillTask,
  unannouncedFillsTask,
} from "./order-tasks.js";

/**
 * The {@link OrderStore} on `engine.sqlite`: each call runs one store task, and a set of moves
 * runs in one transaction, which reads the confirmation and the agent a move into `active` needs.
 */
export function createSqliteOrderStore(host: StoreHost): OrderStore {
  return {
    create: bindTask(host, createOrderTask),
    get: bindTask(host, getOrderTask),
    byIntent: bindTask(host, orderByIntentTask),
    list: bindTask(host, listOrdersTask),
    move: bindTask(host, moveOrdersTask),
    recordFill: bindTask(host, recordOrderFillTask),
    recordLandedFill: bindTask(host, recordLandedFillTask),
    countedFill: bindTask(host, countedFillTask),
    copyBuys: bindTask(host, copyBuysTask),
    fills: bindTask(host, listOrderFillsTask),
    unannounced: bindTask(host, unannouncedFillsTask),
    markAnnounced: bindTask(host, markAnnouncedTask),
  };
}
