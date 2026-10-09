import { join } from "node:path";
import { createSecret, err } from "@binference/core";
import { createManualClock, createMemorySecretStore } from "@binference/core/testing";
import { createPlatform, type Platform } from "@binference/platform";
import { createTempFolder, type TempFolder } from "@binference/platform/testing";
import { createAgentKey, createP256KeyPair, type P256KeyPair } from "@binference/signer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import { type InstallKeysOptions, openInstallKeys } from "./install-keys.js";

const installId = "ins_0190f1c2-3a4b-7c5d-8e6f-000000000001";
const signal = (): AbortSignal => AbortSignal.timeout(20_000);

let folder: TempFolder;
let platform: Platform;

beforeEach(async () => {
  folder = await createTempFolder("bnf-install-");
  platform = createPlatform({ binferenceHome: join(folder.path, "home") });
});

afterEach(async () => {
  await folder.remove();
});

async function optionsWith(agentKeyPublic?: string): Promise<{
  readonly options: InstallKeysOptions;
  readonly pair: P256KeyPair;
}> {
  const keychain = createMemorySecretStore({ "privy-app-secret": "app secret" });
  const created = await createAgentKey(keychain, signal());
  const pair = created.ok ? created.value : createP256KeyPair();
  const options: InstallKeysOptions = {
    agentKeyPublic: agentKeyPublic ?? pair.publicKey,
    installId,
    unlock: {
      config: {
        engine: { unlock: { mode: "keychain" } },
        custody: { privy: { appSecret: { fromKeychain: "privy-app-secret" } } },
      },
      platform: { ...platform, keychain },
      secrets: createSecretReader({
        env: {},
        keychain,
        homeDir: folder.path,
        clock: createManualClock(0),
      }),
      env: {},
    },
  };
  return { options, pair };
}

describe("an install's keys", () => {
  it("open when the agent key is the one the install's wallets name as their signer", async () => {
    const { options, pair } = await optionsWith();
    const opened = await openInstallKeys(options, { signal: signal() });
    expect(opened).toMatchObject({ ok: true, value: { agentPublicKey: pair.publicKey } });
  });

  it("stay locked when the agent key is another than the wallets' signer", async () => {
    const other = createP256KeyPair();
    const { options } = await optionsWith(other.publicKey);
    await expect(openInstallKeys(options, { signal: signal() })).resolves.toStrictEqual(
      err("agent_key_invalid"),
    );
  });

  it("pass the owner's passphrase on to the manual mode", async () => {
    const { options } = await optionsWith();
    const manual = {
      ...options,
      unlock: {
        ...options.unlock,
        config: { ...options.unlock.config, engine: { unlock: { mode: "manual" } } },
      },
    } as const;
    await expect(
      openInstallKeys(manual, { passphrase: createSecret("no file holds this"), signal: signal() }),
    ).resolves.toStrictEqual(err("agent_key_missing"));
    await expect(openInstallKeys(manual, { signal: signal() })).resolves.toStrictEqual(
      err("needs_passphrase"),
    );
  });
});
