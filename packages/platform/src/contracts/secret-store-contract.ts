import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { SecretStore } from "../ports.js";

/** Makes a store that holds exactly the given entries, under names no other check uses. */
export interface SecretStoreHarness {
  create(entries: Readonly<Record<string, string>>): Promise<SecretStore>;
}

const signal = (): AbortSignal => new AbortController().signal;

/** The contract every `SecretStore` adapter passes. */
export function secretStoreContract(harness: SecretStoreHarness): readonly ContractCheck[] {
  return [
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
        assert.deepEqual(await store.read("privy-app-secret", signal()), {
          ok: false,
          error: "not_found",
        });
      },
    },
    {
      name: "keeps each entry apart",
      run: async () => {
        const store = await harness.create({
          "binference-key": "first",
          "privy-app-secret": "second",
        });
        const first = await store.read("binference-key", signal());
        const second = await store.read("privy-app-secret", signal());
        assert.ok(first.ok && second.ok);
        assert.deepEqual([first.value.reveal(), second.value.reveal()], ["first", "second"]);
      },
    },
    {
      name: "reads nothing on an aborted signal",
      run: async () => {
        const store = await harness.create({ "telegram-bot": "token" });
        const reason = new Error("stopped");
        await assert.rejects(store.read("telegram-bot", AbortSignal.abort(reason)), reason);
      },
    },
  ];
}
