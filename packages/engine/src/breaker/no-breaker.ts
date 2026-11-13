import type { BreakerSource } from "../ports.js";

/**
 * The {@link BreakerSource} of an install no breaker holds: every read answers not pulled, at
 * version 0, so the engine never applies a pull or a lift (decision 0439).
 */
export const noBreaker: BreakerSource = {
  read: async ({ signal }) => {
    signal.throwIfAborted();
    return Promise.resolve({ pulled: false, version: 0 });
  },
};
