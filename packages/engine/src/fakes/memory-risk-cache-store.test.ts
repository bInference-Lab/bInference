import { describe, expect, it } from "vitest";
import { riskCacheStoreContract } from "../contracts/risk-cache-store-contract.js";
import { createMemoryRiskCacheStore } from "./memory-risk-cache-store.js";

describe("memory risk cache store", () => {
  it.each(
    riskCacheStoreContract({
      create: async () =>
        await Promise.resolve({
          store: createMemoryRiskCacheStore(["first", "second"]),
          sources: ["first", "second"] as const,
          refused: "third",
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
