import type { QuotaSource } from "../ports.js";
import { type Quotas, quotasSchema } from "../quotas/quotas.js";

/** A quota source in memory whose quotas a test sets, as a hosted reader of each user's would. */
export interface MemoryQuotaSource extends QuotaSource {
  /** Puts these quotas in force from the next read on. */
  set(quotas: Quotas): void;
}

/** Creates a {@link MemoryQuotaSource} that answers these quotas, none when left out. */
export function createMemoryQuotaSource(quotas: Quotas = {}): MemoryQuotaSource {
  let current = quotasSchema.parse(quotas);
  return {
    set(next) {
      current = quotasSchema.parse(next);
    },
    read: async ({ signal }) => {
      signal.throwIfAborted();
      return Promise.resolve({ ...current });
    },
  };
}
