import type { OwnerBinding } from "../surfaces/owner-binding.js";
import type { OwnerStore } from "../surfaces/ports.js";

/** Creates an in-memory {@link OwnerStore} with no owner, for tests. */
export function createMemoryOwnerStore(): OwnerStore {
  let owner: OwnerBinding | undefined;
  return {
    get: async (options) => {
      options.signal.throwIfAborted();
      return Promise.resolve(owner === undefined ? undefined : { ...owner });
    },
    bind: async (binding, options) => {
      options.signal.throwIfAborted();
      const replaced = owner;
      owner = { ...binding };
      return Promise.resolve(replaced);
    },
  };
}
