import { BinferenceError, createSecret, err, ok } from "@binference/core";
import { AsyncEntry } from "@napi-rs/keyring";
import type { SecretStore } from "../ports.js";
import { checkSecretName } from "./secret-name.js";

/** Where the keychain store keeps its entries. */
export interface KeychainSecretStoreOptions {
  /** The keychain service; `binference` when left out. Tests pass a name of their own. */
  readonly service?: string;
}

// A keychain can wait for the owner, such as macOS asking to allow a new Node binary.
const keychainTimeoutMs = 60_000;

/**
 * The OS keychain as a {@link SecretStore}, through `@napi-rs/keyring`: Keychain on macOS,
 * Credential Manager on Windows and the Secret Service on Linux, each entry an account under the
 * service. Throws `platform.keychain_failed` when the keychain refuses or gives no answer within 60
 * seconds, as with no desktop session, a locked keychain or no Secret Service; the owner then picks
 * another unlock mode, such as the passphrase store.
 */
export function createKeychainSecretStore(options: KeychainSecretStoreOptions = {}): SecretStore {
  const service = options.service ?? "binference";
  const call = async <T>(
    name: string,
    signal: AbortSignal,
    action: (entry: AsyncEntry, limit: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    checkSecretName(name);
    signal.throwIfAborted();
    try {
      const limit = AbortSignal.any([signal, AbortSignal.timeout(keychainTimeoutMs)]);
      // On Linux the library otherwise falls back to the kernel keyring without a word when no
      // Secret Service answers, and that keyring forgets everything at a reboot.
      const entry = new AsyncEntry(service, name, { linux: { store: "secret-service" } });
      return await action(entry, limit);
    } catch (error) {
      if (signal.aborted) {
        throw signal.reason;
      }
      throw new BinferenceError({
        code: "platform.keychain_failed",
        message:
          `The OS keychain did not answer for ${service}/${name}; unlock it, start a Secret ` +
          "Service on Linux, or pick another unlock mode.",
        cause: error,
        details: { service, name },
      });
    }
  };
  return {
    read: async (name, signal) => {
      // The library resolves null for a missing entry, though its types say undefined.
      const value = await call(name, signal, async (entry, limit) => entry.getPassword(limit));
      return typeof value === "string" ? ok(createSecret(value)) : err("not_found");
    },
    write: async (name, value, signal) =>
      call(name, signal, async (entry, limit) => entry.setPassword(value.reveal(), limit)),
    delete: async (name, signal) =>
      (await call(name, signal, async (entry, limit) => entry.deleteCredential(limit)))
        ? ok(undefined)
        : err("not_found"),
  };
}
