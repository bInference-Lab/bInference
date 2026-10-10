import type { NoticeStore } from "@binference/engine/notices";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import {
  listNoticesTask,
  moveDeliveryTask,
  pruneNoticesTask,
  queuedDeliveriesTask,
  recordNoticeTask,
} from "./notice-tasks.js";

/** The {@link NoticeStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteNoticeStore(host: StoreHost): NoticeStore {
  return {
    record: bindTask(host, recordNoticeTask),
    list: bindTask(host, listNoticesTask),
    queued: bindTask(host, queuedDeliveriesTask),
    move: bindTask(host, moveDeliveryTask),
    prune: bindTask(host, pruneNoticesTask),
  };
}
