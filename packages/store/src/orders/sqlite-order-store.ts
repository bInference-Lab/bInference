import type { OrderStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  createOrderTask,
  getOrderTask,
  listOrderFillsTask,
  listOrdersTask,
  moveOrdersTask,
  orderByIntentTask,
  recordOrderFillTask,
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
    fills: bindTask(host, listOrderFillsTask),
  };
}
