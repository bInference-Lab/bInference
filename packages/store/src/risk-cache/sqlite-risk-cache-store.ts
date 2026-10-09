import type { RiskCacheStore } from "@binference/engine";
import { bindTask, type StoreHost } from "../tasks/store-host.js";
import { readRiskTask, writeRiskTask } from "./risk-cache-tasks.js";

/**
 * The {@link RiskCacheStore} on `engine.sqlite`'s `risk_cache` table: each call runs one store
 * task. The table keeps reports of `goplus`, `honeypot` and `simulation` only; any other source is
 * refused by its check as `store.constraint`.
 */
export function createSqliteRiskCacheStore(host: StoreHost): RiskCacheStore {
  const write = bindTask(host, writeRiskTask);
  return {
    read: bindTask(host, readRiskTask),
    write: async (entry, options) => {
      await write(entry, options);
    },
  };
}
