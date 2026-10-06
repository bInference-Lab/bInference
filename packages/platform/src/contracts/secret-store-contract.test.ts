import { createSecret, ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { secretStoreContract } from "./secret-store-contract.js";

describe("secret store contract", () => {
  it("fails a store that answers every name with the same value", async () => {
    const checks = secretStoreContract({
      create: async () => ({ read: async () => ok(createSecret("same")) }),
    });
    const results = await Promise.allSettled(
      checks.map(async (check: ContractCheck) => check.run()),
    );
    expect(results.map((result) => result.status)).toStrictEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ]);
  });
});
