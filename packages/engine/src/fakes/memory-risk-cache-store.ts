import type { RiskCacheStore } from "../ports.js";
import type { CachedRiskReport, RiskCacheKey } from "../risk/cached-risk-report.js";
import { constraintFault, memoryCall } from "./memory-call.js";

function keyOf({ asset, source }: RiskCacheKey): string {
  return `${source} ${asset}`;
}

/**
 * Creates an empty in-memory {@link RiskCacheStore} for tests that keeps reports of the sources
 * named, as the SQLite table's check names its own; any other source is a `store.constraint`
 * fault.
 */
export function createMemoryRiskCacheStore(sources: readonly string[]): RiskCacheStore {
  const rows = new Map<string, CachedRiskReport>();
  return {
    read: async (key, options) =>
      memoryCall(options, () => {
        const row = rows.get(keyOf(key));
        return row === undefined ? undefined : structuredClone(row);
      }),
    write: async (entry, options) =>
      memoryCall(options, () => {
        if (!sources.includes(entry.source)) {
          throw constraintFault(`the risk cache keeps no reports of ${entry.source}`);
        }
        rows.set(keyOf(entry), structuredClone(entry));
      }),
  };
}
