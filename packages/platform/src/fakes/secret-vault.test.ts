import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { secretStoreContract } from "../contracts/secret-store-contract.js";
import { createSecretVault } from "./secret-vault.js";

const signal = new AbortController().signal;

describe("secret vault", () => {
  it.each(
    secretStoreContract({
      create: async (entries) => {
        const store = createSecretVault().storeFor("owner-a");
        await Promise.all(
          Object.entries(entries).map(async ([name, value]: readonly [string, string]) =>
            store.write(name, createSecret(value), signal),
          ),
        );
        return store;
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("keeps each owner's entries apart under the same name", async () => {
    const vault = createSecretVault();
    await vault.storeFor("owner-a").write("telegram-bot", createSecret("a-token"), signal);
    await expect(vault.storeFor("owner-b").read("telegram-bot", signal)).resolves.toStrictEqual({
      ok: false,
      error: "not_found",
    });
    await expect(vault.storeFor("owner-a").delete("telegram-bot", signal)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    });
  });
});
