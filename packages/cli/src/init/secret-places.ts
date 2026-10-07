import { join } from "node:path";
import type { SecretStore } from "@binference/core";
import { createFileSecretStore, type Platform } from "@binference/platform";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";

/** Where init keeps a secret a person typed, and the source the config names it by. */
export interface SecretPlace {
  readonly store: SecretStore;
  /** The config's source for the entry `name` of this store. */
  readonly sourceOf: (name: string) => SecretSource;
  /** `keychain` or `file`, for the summary. */
  readonly kind: "keychain" | "file";
}

/** The keychain entry or `keys/` file that holds the Privy app secret (keys spec, section 3). */
export const appSecretEntry = "privy-app-secret";
/** The keychain entry or `keys/` file that holds the bot token (config spec, section 7). */
export const botTokenEntry = "telegram-bot";

function keychainPlace(platform: Platform): SecretPlace {
  return {
    store: platform.keychain,
    sourceOf: (name) => ({ fromKeychain: name }),
    kind: "keychain",
  };
}

function filePlace(platform: Platform): SecretPlace {
  const folder = platform.stateFolder.keys;
  return {
    store: createFileSecretStore({ folder, permissions: platform.permissions }),
    sourceOf: (name) => ({ fromFile: join(folder, name) }),
    kind: "file",
  };
}

/**
 * Where the secrets a person types at init live, by unlock mode (keys spec, section 3): the OS
 * keychain in `keychain` mode, owner-only files in `keys/` in `file` mode. The `manual` and
 * `command` modes hold only the agent key their own way, so the Privy app secret and the bot
 * token go where the machine keeps them by default: the keychain with a desktop session, else
 * `keys/`.
 */
export function secretPlaceOf(mode: UnlockMode, platform: Platform): SecretPlace {
  const isKeychain = mode === "keychain" || (mode !== "file" && platform.hasDesktopSession);
  return isKeychain ? keychainPlace(platform) : filePlace(platform);
}
