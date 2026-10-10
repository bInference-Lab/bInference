import { type TokenRiskSource } from "@binference/chain";
import { type Clock, ok } from "@binference/core";
import type { RiskCacheStore } from "../ports.js";

/** Where a cached source keeps its reports, and for how long one holds. */
export interface RiskSourceCache {
  readonly store: RiskCacheStore;
  readonly clock: Clock;
  /** How long a report holds: config's `risk.cacheTtlSec`, in milliseconds. */
  readonly ttlMs: number;
}

// A report stamped in the future, after the clock stepped back, is never fresh.
function isFresh(ageMs: number, ttlMs: number): boolean {
  return ageMs >= 0 && ageMs < ttlMs;
}

/**
 * A risk source that answers from the cache while the source's last report for the token is
 * younger than the cache's time to live, and asks the source otherwise, storing what it reports.
 * A report stamped later than now counts as stale.
 * A token the source does not cover, and a source that is down, are never stored, so the next
 * check asks again.
 */
export function cachedRiskSource(source: TokenRiskSource, cache: RiskSourceCache): TokenRiskSource {
  const { store, clock, ttlMs } = cache;
  return {
    id: source.id,
    async check(asset, options) {
      const key = { asset, source: source.id };
      const cached = await store.read(key, options);
      if (cached !== undefined && isFresh(clock.now() - cached.fetchedAtMs, ttlMs)) {
        return ok(cached.report);
      }
      const answer = await source.check(asset, options);
      if (answer.ok) {
        await store.write({ ...key, report: answer.value, fetchedAtMs: clock.now() }, options);
      }
      return answer;
    },
  };
}
