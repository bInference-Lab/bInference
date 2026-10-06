import type { LedgerStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { appendLedgerTask, lastLedgerTask, listLedgerTask } from "./ledger-tasks.js";

/** The {@link LedgerStore} on `engine.sqlite`: each call runs one store task. */
export function createSqliteLedgerStore(host: StoreHost): LedgerStore {
  const last = bindTask(host, lastLedgerTask);
  return {
    append: bindTask(host, appendLedgerTask),
    list: bindTask(host, listLedgerTask),
    last: async (options) => last(null, options),
  };
}
