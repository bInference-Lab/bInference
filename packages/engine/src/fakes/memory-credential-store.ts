import type { CredentialEntry } from "../credentials/credential-record.js";
import type { CredentialStore } from "../credentials/ports.js";

// A credential as reads give it, without the time it was removed.
const viewOf = ({ name, allowedHosts, updatedAtMs }: CredentialEntry): CredentialEntry => ({
  name,
  allowedHosts,
  updatedAtMs,
});

/**
 * Credentials in memory, for tests (decision 0388): each by name with its hosts, listed by name, a
 * removed one hidden until purged. It follows {@link CredentialStore} and passes its contract
 * suite.
 */
export function createMemoryCredentialStore(): CredentialStore {
  const held = new Map<string, CredentialEntry & { readonly removedAtMs?: number }>();
  const live = (name: string) => {
    const found = held.get(name);
    return found === undefined || found.removedAtMs !== undefined ? undefined : found;
  };
  return {
    list: async () =>
      Promise.resolve(
        [...held.values()]
          .filter((entry) => entry.removedAtMs === undefined)
          .map(viewOf)
          .toSorted((a, b) => a.name.localeCompare(b.name)),
      ),
    get: async (name) => {
      const found = live(name);
      return Promise.resolve(found === undefined ? undefined : viewOf(found));
    },
    put: async ({ name, allowedHosts, atMs }) => {
      held.set(name, { name, allowedHosts: [...allowedHosts], updatedAtMs: atMs });
      return Promise.resolve();
    },
    remove: async (name, { atMs }) => {
      const found = live(name);
      if (found !== undefined) {
        held.set(name, { ...found, removedAtMs: atMs });
      }
      return Promise.resolve(found !== undefined);
    },
    purge: async (beforeMs) => {
      const gone = [...held.values()].filter(
        (entry) => entry.removedAtMs !== undefined && entry.removedAtMs < beforeMs,
      );
      gone.forEach((entry) => held.delete(entry.name));
      return Promise.resolve(gone.length);
    },
  };
}
