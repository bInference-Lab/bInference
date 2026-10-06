import { createSecret, err, ok } from "@binference/core";
import type { SecretStore } from "../ports.js";

/**
 * Creates a {@link SecretStore} for tests that holds the given entries in memory, as the OS
 * keychain would hold them under the service `binference`.
 */
export function createMemorySecretStore(entries: Readonly<Record<string, string>>): SecretStore {
  const held = new Map(Object.entries(entries));
  return {
    read: async (name, signal) => {
      signal.throwIfAborted();
      await Promise.resolve();
      const value = held.get(name);
      return value === undefined ? err("not_found") : ok(createSecret(value));
    },
  };
}
