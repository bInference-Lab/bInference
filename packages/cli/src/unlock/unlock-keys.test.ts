import { join } from "node:path";
import {
  BinferenceError,
  createSecret,
  err,
  type Secret,
  type SecretStore,
} from "@binference/core";
import { createManualClock, createMemorySecretStore } from "@binference/core/testing";
import {
  createFileSecretStore,
  createPassphraseSecretStore,
  createPlatform,
  ensurePrivateFolder,
  type Platform,
  writePrivateFile,
} from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import {
  createAgentKey,
  createP256KeyPair,
  formatAgentKey,
  type P256KeyPair,
  parseAgentKey,
} from "@binference/signer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { UnlockMode } from "../config/schema/engine.schema.js";
import type { SecretSource } from "../config/schema/secret-source.schema.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import { type UnlockOptions, unlockKeys } from "./unlock-keys.js";

const installId = "ins_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const appSecret = "privy-app-secret-the-tests-read";
const signal = (): AbortSignal => AbortSignal.timeout(20_000);

let folder: TempFolder;
let platform: Platform;

beforeEach(async () => {
  folder = await createTempFolder("bnf-unlock-");
  platform = createPlatform({ binferenceHome: join(folder.path, "home") });
});

afterEach(async () => {
  await folder.remove();
});

interface Setup {
  readonly mode: UnlockMode;
  readonly command?: readonly string[];
  readonly appSecret?: SecretSource;
  readonly keychain?: SecretStore;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly passphrase?: Secret;
}

function optionsOf(setup: Setup): UnlockOptions {
  const keychain = setup.keychain ?? createMemorySecretStore({ "privy-app-secret": appSecret });
  const unlock =
    setup.command === undefined
      ? { mode: setup.mode }
      : { mode: setup.mode, command: { fromCommand: setup.command } };
  const source = setup.appSecret ?? { fromKeychain: "privy-app-secret" };
  return {
    config: { engine: { unlock }, custody: { privy: { appSecret: source } } },
    platform: { ...platform, keychain },
    secrets: createSecretReader({
      env: {},
      keychain,
      homeDir: folder.path,
      clock: createManualClock(0),
    }),
    env: setup.env ?? {},
    installId,
    ...(setup.passphrase === undefined ? {} : { passphrase: setup.passphrase }),
  };
}

function keysStore(): SecretStore {
  return createFileSecretStore({
    folder: platform.stateFolder.keys,
    permissions: platform.permissions,
  });
}

async function storedKey(store: SecretStore): Promise<P256KeyPair> {
  const created = await createAgentKey(store, signal());
  if (!created.ok) {
    throw new Error("Expected a new agent key.");
  }
  return created.value;
}

async function unlocked(setup: Setup) {
  const outcome = await unlockKeys(optionsOf(setup), { signal: signal() });
  if (!outcome.ok) {
    throw new Error(`Expected the keys, got ${outcome.error}.`);
  }
  const pair = parseAgentKey(outcome.value.agentKey);
  return {
    publicKey: pair.ok ? pair.value.publicKey : "unreadable",
    agentPublicKey: outcome.value.agentPublicKey,
    appSecret: outcome.value.appSecret.reveal(),
  };
}

// A credentials folder as systemd fills it for a unit with `LoadCredential=`.
async function credentialsFolder(entries: Readonly<Record<string, string>>): Promise<string> {
  const path = join(folder.path, "credentials");
  const files = { permissions: platform.permissions, signal: signal() };
  await ensurePrivateFolder(path, files);
  await Promise.all(
    Object.entries(entries).map(async ([name, value]) =>
      writePrivateFile(join(path, name), value, files),
    ),
  );
  return path;
}

describe("unlock in keychain mode", () => {
  it("reads the agent key and the app secret from the OS keychain", async () => {
    const keychain = createMemorySecretStore({ "privy-app-secret": appSecret });
    const pair = await storedKey(keychain);
    expect(await unlocked({ mode: "keychain", keychain })).toStrictEqual({
      publicKey: pair.publicKey,
      agentPublicKey: pair.publicKey,
      appSecret,
    });
  });

  it("stays locked when the keychain holds no agent key", async () => {
    const outcome = await unlockKeys(optionsOf({ mode: "keychain" }), { signal: signal() });
    expect(outcome).toStrictEqual(err("agent_key_missing"));
  });

  it("stays locked when the keychain does not answer", async () => {
    const failing: SecretStore = {
      ...createMemorySecretStore({}),
      read: async () =>
        Promise.reject(new BinferenceError({ code: "platform.keychain_failed", message: "No." })),
    };
    const options = optionsOf({ mode: "keychain", keychain: failing });
    expect(await unlockKeys(options, { signal: signal() })).toStrictEqual(err("keychain_failed"));
  });

  it("stays locked when the entry holds something other than an agent key", async () => {
    const keychain = createMemorySecretStore({ "agent-key": "not a key", "privy-app-secret": "x" });
    const options = optionsOf({ mode: "keychain", keychain });
    expect(await unlockKeys(options, { signal: signal() })).toStrictEqual(err("agent_key_invalid"));
  });
});

describe("unlock in file mode", () => {
  it("reads both secrets from the owner-only files in the keys folder", async () => {
    const pair = await storedKey(keysStore());
    await keysStore().write("privy-app-secret", createSecret(appSecret), signal());
    const source = { fromFile: join(platform.stateFolder.keys, "privy-app-secret") };
    expect(await unlocked({ mode: "file", appSecret: source })).toMatchObject({
      publicKey: pair.publicKey,
      appSecret,
    });
  });

  it("reads both secrets from systemd's credentials when the unit passes them", async () => {
    const pair = createP256KeyPair();
    const text = formatAgentKey(pair).reveal();
    const credentials = await credentialsFolder({
      "binference-agent-key": `${text}\n`,
      "binference-privy-secret": `${appSecret}\n`,
    });
    const setup = {
      mode: "file",
      appSecret: { fromEnv: "UNSET" },
      env: { CREDENTIALS_DIRECTORY: credentials },
    } as const;
    expect(await unlocked(setup)).toMatchObject({ publicKey: pair.publicKey, appSecret });
  });

  it("falls back to the keys folder for a secret the credentials leave out", async () => {
    const pair = await storedKey(keysStore());
    const credentials = await credentialsFolder({ "binference-privy-secret": appSecret });
    const setup = { mode: "file", env: { CREDENTIALS_DIRECTORY: credentials } } as const;
    expect(await unlocked(setup)).toMatchObject({ publicKey: pair.publicKey, appSecret });
  });

  it("stays locked when no file holds the agent key", async () => {
    const options = optionsOf({ mode: "file" });
    expect(await unlockKeys(options, { signal: signal() })).toStrictEqual(err("agent_key_missing"));
  });
});

describe("unlock in command mode", () => {
  it("reads the agent key a program prints and the app secret from its source", async () => {
    const pair = await storedKey(keysStore());
    const keyFile = join(platform.stateFolder.keys, "agent-key");
    const printer =
      "process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8'))";
    const command = [process.execPath, "-e", printer, keyFile];
    expect(await unlocked({ mode: "command", command })).toMatchObject({
      publicKey: pair.publicKey,
      appSecret,
    });
  });

  it("stays locked when the program fails", async () => {
    const command = [process.execPath, "-e", "process.exit(3)"];
    const options = optionsOf({ mode: "command", command });
    expect(await unlockKeys(options, { signal: signal() })).toStrictEqual(err("command_failed"));
  });
});

describe("unlock in manual mode", () => {
  const passphrase = createSecret("correct horse battery staple");

  async function sealedKey(): Promise<P256KeyPair> {
    const store = createPassphraseSecretStore({
      folder: platform.stateFolder.keys,
      installId,
      passphrase,
      permissions: platform.permissions,
      scryptCost: 1024,
    });
    return storedKey(store);
  }

  it("stays locked until the owner gives the passphrase", async () => {
    await sealedKey();
    const options = optionsOf({ mode: "manual" });
    expect(await unlockKeys(options, { signal: signal() })).toStrictEqual(err("needs_passphrase"));
  });

  it("opens the sealed agent key with the owner's passphrase", async () => {
    const pair = await sealedKey();
    expect(await unlocked({ mode: "manual", passphrase })).toMatchObject({
      publicKey: pair.publicKey,
      appSecret,
    });
  });

  it("stays locked for a wrong or empty passphrase", async () => {
    await sealedKey();
    const outcomes = await Promise.all(
      ["wrong horse battery staple", ""].map(async (typed) =>
        unlockKeys(optionsOf({ mode: "manual", passphrase: createSecret(typed) }), {
          signal: signal(),
        }),
      ),
    );
    expect(outcomes).toStrictEqual([err("wrong_passphrase"), err("wrong_passphrase")]);
  });
});

describe("the app secret", () => {
  it("keeps the engine locked when config names none, or its source has none", async () => {
    const keychain = createMemorySecretStore({});
    await storedKey(keychain);
    const missing = optionsOf({ mode: "keychain", keychain });
    const withoutSource = {
      ...missing,
      config: { ...missing.config, custody: { privy: {} } },
    };
    expect(await unlockKeys(withoutSource, { signal: signal() })).toStrictEqual(
      err("app_secret_missing"),
    );
    expect(await unlockKeys(missing, { signal: signal() })).toStrictEqual(
      err("app_secret_unavailable"),
    );
  });
});
