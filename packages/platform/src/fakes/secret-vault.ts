import type { SecretStore } from "../ports.js";
import { createMemorySecretStore } from "./memory-secret-store.js";

/**
 * A secret service for tests that many owners share, as a hosted secret store is: each owner reads
 * and writes their own entries only, under the same names another owner uses.
 */
export interface SecretVault {
  /** The store of one owner's entries; the same owner always gets the same entries. */
  storeFor(owner: string): SecretStore;
}

/** Creates an empty {@link SecretVault}. */
export function createSecretVault(): SecretVault {
  const stores = new Map<string, SecretStore>();
  return {
    storeFor(owner) {
      const store = stores.get(owner) ?? createMemorySecretStore({});
      stores.set(owner, store);
      return store;
    },
  };
}
