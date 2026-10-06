import { createSecret, err, ok } from "@binference/core";
import { checkSecretName } from "../keychain/secret-name.js";
import type { SecretStore } from "../ports.js";

async function start(name: string, signal: AbortSignal): Promise<void> {
  checkSecretName(name);
  signal.throwIfAborted();
  await Promise.resolve();
}

/**
 * Creates a {@link SecretStore} for tests that holds the given entries in memory, as the OS
 * keychain would hold them under the service `binference`. It checks names as every store does.
 */
export function createMemorySecretStore(entries: Readonly<Record<string, string>>): SecretStore {
  const held = new Map(Object.entries(entries));
  return {
    read: async (name, signal) => {
      await start(name, signal);
      const value = held.get(name);
      return value === undefined ? err("not_found") : ok(createSecret(value));
    },
    write: async (name, value, signal) => {
      await start(name, signal);
      held.set(name, value.reveal());
    },
    delete: async (name, signal) => {
      await start(name, signal);
      return held.delete(name) ? ok(undefined) : err("not_found");
    },
  };
}
