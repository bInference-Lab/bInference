import type { QuotaSource } from "../ports.js";

/**
 * The {@link QuotaSource} that holds no quota: every read answers none, so nothing is counted and
 * nothing refused for a quota (decision 0431).
 */
export const noQuotas: QuotaSource = {
  read: async ({ signal }) => {
    signal.throwIfAborted();
    return Promise.resolve({});
  },
};
