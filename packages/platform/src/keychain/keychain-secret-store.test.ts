import { createSecret } from "@binference/core";
import { secretStoreContract } from "@binference/core/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeychainSecretStore } from "./keychain-secret-store.js";

// Stands in for @napi-rs/keyring, so these tests never touch the machine's keychain. The tests on
// the real keychain live in keychain-secret-store.native.test.ts.
const keychain = vi.hoisted(() => ({
  held: new Map<string, string>(),
  opened: [] as unknown[][],
  refusal: undefined as Error | undefined,
  missing: null as null | undefined,
  hangs: false,
}));

interface FakeEntry {
  getPassword(signal?: AbortSignal): Promise<string | null | undefined>;
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}

// Never settles until the call's signal aborts, as a keychain waiting on a dialog.
async function hang(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("AbortError")));
  });
}

vi.mock("@napi-rs/keyring", () => ({
  AsyncEntry: vi.fn<(service: string, account: string, options: unknown) => FakeEntry>(
    function openEntry(service, account, options) {
      keychain.opened.push([service, account, options]);
      if (keychain.refusal !== undefined) {
        throw keychain.refusal;
      }
      const key = `${service}/${account}`;
      return {
        getPassword: async (signal) =>
          keychain.hangs ? hang(signal) : (keychain.held.get(key) ?? keychain.missing),
        setPassword: async (password) => {
          keychain.held.set(key, password);
        },
        deleteCredential: async () => keychain.held.delete(key),
      };
    },
  ),
}));

let services = 0;

beforeEach(() => {
  keychain.refusal = undefined;
  keychain.missing = null;
  keychain.hangs = false;
});

describe("keychain secret store", () => {
  it.each(
    secretStoreContract({
      create: async (entries) => {
        services += 1;
        const store = createKeychainSecretStore({ service: `test-${String(services)}` });
        await Promise.all(
          Object.entries(entries).map(async ([name, value]) =>
            store.write(name, createSecret(value), new AbortController().signal),
          ),
        );
        return store;
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("opens each entry under the binference service, with the Secret Service required on Linux", async () => {
    await createKeychainSecretStore().read("telegram-bot", new AbortController().signal);

    expect(keychain.opened.at(-1)).toStrictEqual([
      "binference",
      "telegram-bot",
      { linux: { store: "secret-service" } },
    ]);
  });

  it("answers not_found when the library gives undefined for a missing entry", async () => {
    keychain.missing = undefined;

    await expect(
      createKeychainSecretStore().read("privy-app-secret", new AbortController().signal),
    ).resolves.toStrictEqual({ ok: false, error: "not_found" });
  });

  it("fails with a code and no secret when the keychain refuses", async () => {
    keychain.refusal = new Error("Couldn't access platform storage: no Secret Service");
    const store = createKeychainSecretStore();

    const failure = await store
      .write("agent-key", createSecret("p256:hidden"), new AbortController().signal)
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "platform.keychain_failed",
      details: { service: "binference", name: "agent-key" },
    });
    expect(String(failure)).not.toContain("hidden");
  });

  it("rejects with the caller's reason when the signal aborts during a call", async () => {
    keychain.hangs = true;
    const controller = new AbortController();
    const reason = new Error("stopped");

    const reading = createKeychainSecretStore().read("telegram-bot", controller.signal);
    controller.abort(reason);

    await expect(reading).rejects.toBe(reason);
  });
});
