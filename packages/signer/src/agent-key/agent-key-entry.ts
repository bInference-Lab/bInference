import { BinferenceError, err, ok, type Result, type SecretStore } from "@binference/core";
import { createP256KeyPair, type P256KeyPair } from "../keys/p256-key-pair.js";
import { formatAgentKey, parseAgentKey } from "./agent-key-text.js";

/**
 * The secret store entry that holds this machine's agent key in every unlock mode: the keychain
 * entry `binference/agent-key`, or `keys/agent-key.json` sealed with the owner's passphrase in the
 * `manual` mode.
 */
export const agentKeyEntry = "agent-key";

/**
 * Opens this machine's agent key from the store its unlock mode names. `not_found` when the store
 * holds no agent key. Throws `signer.agent_key_invalid` when the entry holds something else; the
 * error never holds the entry's text.
 */
export async function openAgentKey(
  store: SecretStore,
  signal: AbortSignal,
): Promise<Result<P256KeyPair, "not_found">> {
  const held = await store.read(agentKeyEntry, signal);
  if (!held.ok) {
    return held;
  }
  const pair = parseAgentKey(held.value);
  if (!pair.ok) {
    throw new BinferenceError({
      code: "signer.agent_key_invalid",
      message:
        `The secret store entry ${agentKeyEntry} holds no agent key; put the key back from where ` +
        "you keep a copy, or attach this machine again with binference init --attach.",
      details: { entry: agentKeyEntry },
    });
  }
  return pair;
}

/**
 * Makes this machine's agent key and stores it in the store its unlock mode names, then opens it
 * again to prove the store kept it. `exists` when the store already holds an agent key: the
 * wallets name that key as their signer, so it is never replaced here. Throws
 * `signer.agent_key_not_stored` when the store does not give the new key back.
 */
export async function createAgentKey(
  store: SecretStore,
  signal: AbortSignal,
): Promise<Result<P256KeyPair, "exists">> {
  if ((await store.read(agentKeyEntry, signal)).ok) {
    return err("exists");
  }
  const pair = createP256KeyPair();
  await store.write(agentKeyEntry, formatAgentKey(pair), signal);
  const stored = await openAgentKey(store, signal);
  if (!stored.ok || stored.value.publicKey !== pair.publicKey) {
    throw new BinferenceError({
      code: "signer.agent_key_not_stored",
      message:
        `The secret store did not give back the agent key written to ${agentKeyEntry}; check ` +
        "that the keychain or the keys folder accepts writes, then run binference init again.",
      details: { entry: agentKeyEntry },
    });
  }
  return ok(pair);
}
