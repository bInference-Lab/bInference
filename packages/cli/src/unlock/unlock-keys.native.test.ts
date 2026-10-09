import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createSecret, type SecretStore } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { createKeychainSecretStore, createPlatform } from "@binference/platform";
import { createTempFolder } from "@binference/platform/testing";
import { agentKeyEntry, createAgentKey, type P256KeyPair } from "@binference/signer";
import { describe, expect, it } from "vitest";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import { unlockKeys } from "./unlock-keys.js";

// The CI job for the OS keychain sets this switch on macOS, Windows, and Linux with a Secret
// Service. The entries go under a service name of their own and are deleted after the check.
const keychainTests = process.env["BINFERENCE_KEYCHAIN_TESTS"] === "1";

async function newAgentKey(keychain: SecretStore, signal: AbortSignal): Promise<P256KeyPair> {
  const created = await createAgentKey(keychain, signal);
  if (!created.ok) {
    throw new Error("Expected a new agent key under a fresh service.");
  }
  return created.value;
}

describe.runIf(keychainTests)("unlock in keychain mode on the OS keychain", () => {
  it("reads the agent key and the app secret init stored there", async () => {
    const signal = AbortSignal.timeout(60_000);
    const keychain = createKeychainSecretStore({ service: `binference-test-${randomUUID()}` });
    const folder = await createTempFolder("bnf-unlock-");
    try {
      const pair = await newAgentKey(keychain, signal);
      await keychain.write("privy-app-secret", createSecret("app-secret-of-the-test"), signal);
      const platform = createPlatform({ binferenceHome: join(folder.path, "home") });
      const outcome = await unlockKeys(
        {
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
          installId: "ins_0190f1c2-3a4b-7c5d-8e6f-000000000001",
        },
        { signal },
      );
      expect(outcome).toMatchObject({
        ok: true,
        value: { agentPublicKey: pair.publicKey },
      });
    } finally {
      await Promise.all(
        [agentKeyEntry, "privy-app-secret"].map(async (name) => keychain.delete(name, signal)),
      );
      await folder.remove();
    }
  });
});
