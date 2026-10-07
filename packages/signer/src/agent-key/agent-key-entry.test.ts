import { inspect } from "node:util";
import { createSecret, err, type Result, type SecretStore } from "@binference/core";
import { createMemorySecretStore } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { createP256KeyPair, type P256KeyPair } from "../keys/p256-key-pair.js";
import { agentKeyEntry, createAgentKey, openAgentKey } from "./agent-key-entry.js";
import { formatAgentKey, parseAgentKey } from "./agent-key-text.js";

const signal = (): AbortSignal => new AbortController().signal;

const publicKeyOf = (result: Result<P256KeyPair, string>): string =>
  result.ok ? result.value.publicKey : result.error;

// The entry's text, or nothing when the store holds no agent key.
async function heldText(store: SecretStore): Promise<string> {
  const held = await store.read(agentKeyEntry, signal());
  return held.ok ? held.value.reveal() : "";
}

// A store that accepts every write and keeps none of them, as a keychain locked under the caller
// might.
const forgetfulStore = (): SecretStore => ({
  read: async () => err("not_found"),
  write: async () => undefined,
  delete: async () => err("not_found"),
});

describe("agent key entry", () => {
  it("stores a new agent key under agent-key and opens the same key again", async () => {
    const store = createMemorySecretStore({});

    const created = publicKeyOf(await createAgentKey(store, signal()));
    const opened = publicKeyOf(await openAgentKey(store, signal()));
    const held = publicKeyOf(parseAgentKey(createSecret(await heldText(store))));

    expect(created).toMatch(/^MFkw/);
    expect([opened, held]).toStrictEqual([created, created]);
  });

  it("refuses to replace an agent key the store already holds", async () => {
    const existing = formatAgentKey(createP256KeyPair()).reveal();
    const store = createMemorySecretStore({ [agentKeyEntry]: existing });

    await expect(createAgentKey(store, signal())).resolves.toStrictEqual(err("exists"));
    await expect(heldText(store)).resolves.toBe(existing);
  });

  it("answers not_found when the store holds no agent key", async () => {
    await expect(openAgentKey(createMemorySecretStore({}), signal())).resolves.toStrictEqual(
      err("not_found"),
    );
  });

  it("names the fault without the entry's text when the entry holds no agent key", async () => {
    const held = "MIGHAgEAleakedtext";
    const opening = openAgentKey(createMemorySecretStore({ [agentKeyEntry]: held }), signal());

    await expect(opening).rejects.toMatchObject({
      code: "signer.agent_key_invalid",
      details: { entry: agentKeyEntry },
    });
    await expect(opening).rejects.toThrow(/binference init --attach/);
    const failure = await opening.catch((error: unknown) => error);
    expect(inspect(failure, { depth: 10 })).not.toContain("leakedtext");
  });

  it("fails with a code when the store does not give the new key back", async () => {
    const creating = createAgentKey(forgetfulStore(), signal());

    await expect(creating).rejects.toMatchObject({
      code: "signer.agent_key_not_stored",
      details: { entry: agentKeyEntry },
    });
    await expect(creating).rejects.toThrow(/run binference init again/);
  });

  it("fails with a code when the store gives another key back", async () => {
    const other = formatAgentKey(createP256KeyPair());
    const memory = createMemorySecretStore({});
    const swapping: SecretStore = {
      ...memory,
      write: async (name, _value, writeSignal) => memory.write(name, other, writeSignal),
    };

    await expect(createAgentKey(swapping, signal())).rejects.toMatchObject({
      code: "signer.agent_key_not_stored",
    });
  });

  it("writes and reads nothing on an aborted signal", async () => {
    const store = createMemorySecretStore({});
    const reason = new Error("stopped");

    await expect(createAgentKey(store, AbortSignal.abort(reason))).rejects.toBe(reason);
    await expect(openAgentKey(store, AbortSignal.abort(reason))).rejects.toBe(reason);
    await expect(heldText(store)).resolves.toBe("");
  });
});
