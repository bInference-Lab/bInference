import { isAbsolute } from "node:path";
import {
  BinferenceError,
  err,
  ok,
  type Result,
  type Secret,
  type SecretStore,
} from "@binference/core";
import {
  createFileSecretStore,
  createPassphraseSecretStore,
  type Platform,
} from "@binference/platform";
import { agentKeyEntry, formatAgentKey, parseAgentKey } from "@binference/signer";
import type { CustodyConfig, EngineConfig, UnlockMode } from "../config/schema/engine.schema.js";
import type { SecretReader } from "../config/secrets/secret-reader.js";

/** What the engine signs with, read through the unlock mode (keys spec, section 3). */
export interface UnlockedKeys {
  /** The agent key's text, as the signer reads it on its standard input. */
  readonly agentKey: Secret;
  /** The agent key's public half: what each wallet's signer quorum holds. */
  readonly agentPublicKey: string;
  /** The owner's Privy app secret. */
  readonly appSecret: Secret;
}

/**
 * Why the engine stays locked. `needs_passphrase`: the `manual` mode waits for the owner's
 * passphrase from `binference unlock`; `wrong_passphrase`: it does not open the sealed file.
 * `agent_key_missing`: the mode holds no agent key; `agent_key_invalid`: it holds something else.
 * `keychain_failed`: the OS keychain did not answer; `command_failed`: the `command` mode's
 * program printed no agent key. `app_secret_missing`: config names no Privy app secret;
 * `app_secret_unavailable`: its source holds none.
 */
export type LockReason =
  | "needs_passphrase"
  | "wrong_passphrase"
  | "agent_key_missing"
  | "agent_key_invalid"
  | "keychain_failed"
  | "command_failed"
  | "app_secret_missing"
  | "app_secret_unavailable";

/** What the unlock reads: config, the platform's stores, and the manual mode's passphrase. */
export interface UnlockOptions {
  readonly config: {
    readonly engine: Pick<EngineConfig, "unlock">;
    readonly custody: { readonly privy: Pick<CustodyConfig["privy"], "appSecret"> };
  };
  readonly platform: Pick<Platform, "keychain" | "stateFolder" | "permissions">;
  /** Reads `engine.unlock.command` and `custody.privy.appSecret`. */
  readonly secrets: SecretReader;
  /** The engine's environment, where systemd names the unit's folder of credentials. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The install's id, which the `manual` mode's sealed file is bound to. */
  readonly installId: string;
  /** The owner's passphrase for the `manual` mode, as `binference unlock` hands it over. */
  readonly passphrase?: Secret;
}

/** The systemd credentials of the `file` mode (keys spec, section 3). */
const credentials = { agentKey: "binference-agent-key", appSecret: "binference-privy-secret" };

// The documented faults of the unlock modes' stores: each leaves the engine locked, with a reason.
const faultReasons: Readonly<Record<string, LockReason>> = {
  "platform.keychain_failed": "keychain_failed",
  "platform.passphrase_rejected": "wrong_passphrase",
  "platform.passphrase_empty": "wrong_passphrase",
  "platform.secret_file_invalid": "agent_key_invalid",
};

type Read = Result<Secret, LockReason>;

// A secret source that has no secret is `unavailable`; the stores' faults have their own reasons.
function reasonOf(error: BinferenceError, unavailable: LockReason): LockReason | undefined {
  return error.code === "config.secret_unavailable" ? unavailable : faultReasons[error.code];
}

async function reading(read: () => Promise<Read>, unavailable: LockReason): Promise<Read> {
  try {
    return await read();
  } catch (error) {
    const reason = error instanceof BinferenceError ? reasonOf(error, unavailable) : undefined;
    if (reason === undefined) {
      throw error;
    }
    return err(reason);
  }
}

async function fromStore(store: SecretStore, name: string, signal: AbortSignal): Promise<Read> {
  const held = await store.read(name, signal);
  return held.ok ? held : err("agent_key_missing");
}

// systemd sets an absolute path; anything else is not its credentials folder. Credentials count
// in the `file` mode only.
async function fromCredentials(
  options: UnlockOptions,
  name: string,
  signal: AbortSignal,
): Promise<Read | undefined> {
  const folder = options.env["CREDENTIALS_DIRECTORY"] ?? "";
  if (options.config.engine.unlock.mode !== "file" || !isAbsolute(folder)) {
    return undefined;
  }
  const { permissions } = options.platform;
  const passed = await createFileSecretStore({ folder, permissions }).read(name, signal);
  return passed.ok && passed.value.reveal() !== "" ? passed : undefined;
}

async function fromFiles(options: UnlockOptions, signal: AbortSignal): Promise<Read> {
  const passed = await fromCredentials(options, credentials.agentKey, signal);
  if (passed !== undefined) {
    return passed;
  }
  const { keys } = options.platform.stateFolder;
  const store = createFileSecretStore({ folder: keys, permissions: options.platform.permissions });
  return fromStore(store, agentKeyEntry, signal);
}

async function fromSealedFile(options: UnlockOptions, signal: AbortSignal): Promise<Read> {
  const { passphrase, platform } = options;
  if (passphrase === undefined) {
    return err("needs_passphrase");
  }
  const store = createPassphraseSecretStore({
    folder: platform.stateFolder.keys,
    installId: options.installId,
    passphrase,
    permissions: platform.permissions,
  });
  return fromStore(store, agentKeyEntry, signal);
}

async function fromCommand(options: UnlockOptions, signal: AbortSignal): Promise<Read> {
  const { command } = options.config.engine.unlock;
  // Config refuses the `command` mode without its program.
  return command === undefined
    ? err("command_failed")
    : ok(await options.secrets.read("engine.unlock.command", command, signal));
}

const agentKeyReaders: Readonly<
  Record<UnlockMode, (options: UnlockOptions, signal: AbortSignal) => Promise<Read>>
> = {
  keychain: async (options, signal) => fromStore(options.platform.keychain, agentKeyEntry, signal),
  file: fromFiles,
  command: fromCommand,
  manual: fromSealedFile,
};

async function appSecretOf(options: UnlockOptions, signal: AbortSignal): Promise<Read> {
  const passed = await fromCredentials(options, credentials.appSecret, signal);
  if (passed !== undefined) {
    return passed;
  }
  const source = options.config.custody.privy.appSecret;
  return source === undefined
    ? err("app_secret_missing")
    : ok(await options.secrets.read("custody.privy.appSecret", source, signal));
}

/**
 * Reads the agent key and the Privy app secret the way `engine.unlock.mode` says (keys spec,
 * section 3): from the OS keychain; from owner-only files in `keys/`, or the systemd credentials
 * `binference-agent-key` and `binference-privy-secret` when the unit passes them; from the
 * program of `engine.unlock.command`; or, in the `manual` mode, from the sealed file the owner's
 * passphrase opens. The app secret comes from `custody.privy.appSecret` in every mode but a
 * `file` mode whose unit passes it. Returns why the engine stays locked when a secret is not
 * there, and throws only a fault outside what each store documents. No error holds a secret.
 */
export async function unlockKeys(
  options: UnlockOptions,
  call: { readonly signal: AbortSignal },
): Promise<Result<UnlockedKeys, LockReason>> {
  const { signal } = call;
  const read = agentKeyReaders[options.config.engine.unlock.mode];
  const text = await reading(async () => read(options, signal), "command_failed");
  if (!text.ok) {
    return text;
  }
  const pair = parseAgentKey(text.value);
  if (!pair.ok) {
    return err("agent_key_invalid");
  }
  const appSecret = await reading(
    async () => appSecretOf(options, signal),
    "app_secret_unavailable",
  );
  if (!appSecret.ok) {
    return appSecret;
  }
  return ok({
    agentKey: formatAgentKey(pair.value),
    agentPublicKey: pair.value.publicKey,
    appSecret: appSecret.value,
  });
}
