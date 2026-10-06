import assert from "node:assert/strict";
import { createSecret, err, ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { SecretStore } from "../ports.js";

/**
 * Makes a store that holds exactly the given entries, under names no other check uses. A store on a
 * real keychain removes what the checks wrote once they end.
 */
export interface SecretStoreHarness {
  create(entries: Readonly<Record<string, string>>): Promise<SecretStore>;
}

const signal = (): AbortSignal => new AbortController().signal;

const notFound = err("not_found");

async function readText(store: SecretStore, name: string): Promise<string | undefined> {
  const read = await store.read(name, signal());
  return read.ok ? read.value.reveal() : undefined;
}

const readChecks = (harness: SecretStoreHarness): readonly ContractCheck[] => [
  {
    name: "reads an entry it holds as a secret that prints as a mark",
    run: async () => {
      const store = await harness.create({ "telegram-bot": "7012345678:AAH-token" });
      const read = await store.read("telegram-bot", signal());
      assert.ok(read.ok);
      assert.equal(read.value.reveal(), "7012345678:AAH-token");
      assert.ok(!String(read.value).includes("AAH-token"));
    },
  },
  {
    name: "answers not_found for a name it does not hold",
    run: async () => {
      const store = await harness.create({ "telegram-bot": "token" });
      assert.deepEqual(await store.read("privy-app-secret", signal()), notFound);
    },
  },
  {
    name: "keeps each entry apart",
    run: async () => {
      const store = await harness.create({
        "binference-key": "first",
        "privy-app-secret": "second",
      });
      assert.deepEqual(
        [await readText(store, "binference-key"), await readText(store, "privy-app-secret")],
        ["first", "second"],
      );
    },
  },
];

const writeChecks = (harness: SecretStoreHarness): readonly ContractCheck[] => [
  {
    name: "reads back an entry it wrote",
    run: async () => {
      const store = await harness.create({});
      await store.write("agent-key", createSecret("p256:written"), signal());
      assert.equal(await readText(store, "agent-key"), "p256:written");
    },
  },
  {
    name: "replaces the value of an entry it holds",
    run: async () => {
      const store = await harness.create({ "agent-key": "old" });
      await store.write("agent-key", createSecret("new"), signal());
      assert.equal(await readText(store, "agent-key"), "new");
    },
  },
  {
    name: "deletes an entry, then answers not_found for it",
    run: async () => {
      const store = await harness.create({ "agent-key": "key", "telegram-bot": "token" });
      assert.deepEqual(await store.delete("agent-key", signal()), ok(undefined));
      assert.deepEqual(await store.read("agent-key", signal()), notFound);
      assert.equal(await readText(store, "telegram-bot"), "token");
    },
  },
  {
    name: "answers not_found to delete a name it does not hold",
    run: async () => {
      const store = await harness.create({});
      assert.deepEqual(await store.delete("agent-key", signal()), notFound);
    },
  },
];

const refusalChecks = (harness: SecretStoreHarness): readonly ContractCheck[] => [
  {
    name: "refuses a name outside the format before it touches the store",
    run: async () => {
      const store = await harness.create({});
      const refusal = { code: "platform.secret_name_invalid" };
      await Promise.all(
        ["", "../agent-key", "Telegram-Bot", "con", "a b"].flatMap((name) => [
          assert.rejects(store.read(name, signal()), refusal),
          assert.rejects(store.write(name, createSecret("value"), signal()), refusal),
          assert.rejects(store.delete(name, signal()), refusal),
        ]),
      );
    },
  },
  {
    name: "reads, writes and deletes nothing on an aborted signal",
    run: async () => {
      const store = await harness.create({ "telegram-bot": "token" });
      const reason = new Error("stopped");
      const aborted = AbortSignal.abort(reason);
      await assert.rejects(store.read("telegram-bot", aborted), reason);
      await assert.rejects(store.write("agent-key", createSecret("key"), aborted), reason);
      await assert.rejects(store.delete("telegram-bot", aborted), reason);
      assert.deepEqual(await store.read("agent-key", signal()), notFound);
      assert.equal(await readText(store, "telegram-bot"), "token");
    },
  },
];

/** The contract every `SecretStore` adapter passes. */
export function secretStoreContract(harness: SecretStoreHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...writeChecks(harness), ...refusalChecks(harness)];
}
