import { describe, expect, it } from "vitest";
import { installStoreContract } from "../contracts/install-store-contract.js";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryInstallStore } from "./memory-install-store.js";

describe("memory install store", () => {
  it.each(
    installStoreContract({
      create: async () =>
        Promise.resolve({
          store: createMemoryInstallStore(),
          agent: fixtureId("agt", 1),
          family: "fake",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
