import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { CredentialStore } from "../credentials/ports.js";

/** Makes a fresh, empty store for each check. */
export interface CredentialStoreHarness {
  create(): Promise<CredentialStore>;
}

const live = { signal: new AbortController().signal };
const put = (name: string, atMs: number, hosts: readonly string[] = ["api.example.com"]) => ({
  name,
  value: `value of ${name}`,
  allowedHosts: hosts,
  atMs,
});

function readChecks(harness: CredentialStoreHarness): readonly ContractCheck[] {
  return [
    {
      name: "lists stored credentials by name with their hosts, never a value",
      run: async () => {
        const store = await harness.create();
        await store.put(put("ZETA_KEY", 2), live);
        await store.put(put("ALPHA_KEY", 1, []), live);
        assert.deepEqual(await store.list(live), [
          { name: "ALPHA_KEY", allowedHosts: [], updatedAtMs: 1 },
          { name: "ZETA_KEY", allowedHosts: ["api.example.com"], updatedAtMs: 2 },
        ]);
        assert.ok(!JSON.stringify(await store.list(live)).includes("value of"));
      },
    },
    {
      name: "stores a credential again in place of the one of its name",
      run: async () => {
        const store = await harness.create();
        await store.put(put("API_KEY", 1), live);
        await store.put(put("API_KEY", 5, ["a.example.com", "b.example.com"]), live);
        assert.deepEqual(await store.get("API_KEY", live), {
          name: "API_KEY",
          allowedHosts: ["a.example.com", "b.example.com"],
          updatedAtMs: 5,
        });
        assert.equal((await store.list(live)).length, 1);
      },
    },
  ];
}

function revealChecks(harness: CredentialStoreHarness): readonly ContractCheck[] {
  return [
    {
      name: "reveals a stored credential's value and hosts, and nothing once it is removed",
      run: async () => {
        const store = await harness.create();
        await store.put(put("API_KEY", 1, ["a.example.com"]), live);
        const revealed = await store.reveal("API_KEY", live);
        assert.deepEqual(
          { name: revealed?.name, allowedHosts: revealed?.allowedHosts },
          { name: "API_KEY", allowedHosts: ["a.example.com"] },
        );
        assert.equal(revealed?.value.reveal(), "value of API_KEY");
        assert.equal(await store.reveal("OTHER_KEY", live), undefined);
        await store.remove("API_KEY", { ...live, atMs: 2 });
        assert.equal(await store.reveal("API_KEY", live), undefined);
      },
    },
  ];
}

function removalChecks(harness: CredentialStoreHarness): readonly ContractCheck[] {
  return [
    {
      name: "removes a credential from every read, and answers false for one that is not there",
      run: async () => {
        const store = await harness.create();
        await store.put(put("API_KEY", 1), live);
        assert.equal(await store.remove("API_KEY", { ...live, atMs: 10 }), true);
        assert.equal(await store.get("API_KEY", live), undefined);
        assert.equal(await store.remove("API_KEY", { ...live, atMs: 11 }), false);
        assert.deepEqual(await store.list(live), []);
      },
    },
    {
      name: "purges removed credentials only once they are older than the line, and stores one again",
      run: async () => {
        const store = await harness.create();
        await store.put(put("OLD_KEY", 1), live);
        await store.put(put("NEW_KEY", 1), live);
        await store.put(put("KEPT_KEY", 1), live);
        await store.remove("OLD_KEY", { ...live, atMs: 10 });
        await store.remove("NEW_KEY", { ...live, atMs: 30 });
        assert.equal(await store.purge(20, live), 1);
        assert.equal(await store.purge(20, live), 0);
        await store.put(put("NEW_KEY", 40), live);
        assert.deepEqual(
          (await store.list(live)).map((entry) => entry.name),
          ["KEPT_KEY", "NEW_KEY"],
        );
      },
    },
  ];
}

/** The contract every `CredentialStore` adapter passes (decision 0388). */
export function credentialStoreContract(harness: CredentialStoreHarness): readonly ContractCheck[] {
  return [...readChecks(harness), ...revealChecks(harness), ...removalChecks(harness)];
}
