import { randomUUID } from "node:crypto";
import { createSecret, type SecretStore } from "@binference/core";
import { secretStoreContract } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createKeychainSecretStore } from "./keychain-secret-store.js";

// The CI job for the OS keychain sets this switch; it runs on macOS, Windows, and Linux with a
// Secret Service. Each store uses a service name of its own, and every entry a check writes is
// deleted after it, so no keychain keeps anything.
// oxlint-disable-next-line node/no-process-env -- the switch for the real keychain, read only here
const keychainTests = process.env["BINFERENCE_KEYCHAIN_TESTS"] === "1";

const written: { readonly store: SecretStore; readonly names: Set<string> }[] = [];

// Records every name written through the store, so the cleanup can delete it.
function tracked(store: SecretStore): SecretStore {
  const names = new Set<string>();
  written.push({ store, names });
  return {
    read: async (name, signal) => store.read(name, signal),
    write: async (name, value, signal) => {
      await store.write(name, value, signal);
      names.add(name);
    },
    delete: async (name, signal) => store.delete(name, signal),
  };
}

afterEach(async () => {
  const signal = AbortSignal.timeout(60_000);
  await Promise.all(
    written
      .splice(0)
      .flatMap(({ store, names }) => [...names].map(async (name) => store.delete(name, signal))),
  );
});

describe.runIf(keychainTests)("keychain secret store on the OS keychain", () => {
  it.each(
    secretStoreContract({
      create: async (entries) => {
        const service = `binference-test-${randomUUID()}`;
        const store = tracked(createKeychainSecretStore({ service }));
        await Promise.all(
          Object.entries(entries).map(async ([name, value]) =>
            store.write(name, createSecret(value), AbortSignal.timeout(60_000)),
          ),
        );
        return store;
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
