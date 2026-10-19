import type { AlertStore } from "@binference/engine/orders";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import type { TaskRunner } from "../tasks/store-task.js";
import { fireAlertTask } from "./alert-fire-task.js";
import {
  createAlertTask,
  deleteAlertTask,
  endAlertTask,
  expireAlertsTask,
  getAlertTask,
  heldNoticesTask,
  listAlertsTask,
} from "./alert-tasks.js";

/** The alert store's tasks, which `engine.sqlite`'s workers serve. */
export const alertTasks: readonly TaskRunner[] = [
  createAlertTask,
  getAlertTask,
  listAlertsTask,
  deleteAlertTask,
  expireAlertsTask,
  endAlertTask,
  heldNoticesTask,
  fireAlertTask,
];

/** The {@link AlertStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteAlertStore(host: StoreHost): AlertStore {
  return {
    create: bindTask(host, createAlertTask),
    get: bindTask(host, getAlertTask),
    list: bindTask(host, listAlertsTask),
    delete: bindTask(host, deleteAlertTask),
    expire: bindTask(host, expireAlertsTask),
    end: bindTask(host, endAlertTask),
    heldNotices: bindTask(host, heldNoticesTask),
    fire: bindTask(host, fireAlertTask),
  };
}
