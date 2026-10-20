import type { AliveStore } from "../downtime/ports.js";

/** Creates an in-memory {@link AliveStore} with no mark, for tests. */
export function createMemoryAliveStore(): AliveStore {
  const kept: { atMs?: number } = {};
  return {
    lastAlive: async (options) => {
      options.signal.throwIfAborted();
      return Promise.resolve(kept.atMs);
    },
    markAlive: async (atMs, options) => {
      options.signal.throwIfAborted();
      kept.atMs = atMs;
      return Promise.resolve();
    },
  };
}
