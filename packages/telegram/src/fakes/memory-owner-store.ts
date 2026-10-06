import { err, ok } from "@binference/core";
import type { OwnerBinding } from "../owner/owner-binding.js";
import type { OwnerStore } from "../ports.js";

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
      if (owner !== undefined) {
        return Promise.resolve(err("bound"));
      }
      owner = { ...binding };
      return Promise.resolve(ok({ ...binding }));
    },
  };
}
