import type { InboxStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { admitTask, markHandledTask, pruneInboxTask, unhandledTask } from "./inbox-tasks.js";

/** The {@link InboxStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteInboxStore(host: StoreHost): InboxStore {
  return {
    admit: bindTask(host, admitTask),
    markHandled: bindTask(host, markHandledTask),
    unhandled: bindTask(host, unhandledTask),
    prune: bindTask(host, pruneInboxTask),
  };
}
