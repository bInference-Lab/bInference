import { describe, expect, it } from "vitest";
import { ok } from "../result.js";
import { createSecret } from "../secret/secret.js";
import type { ContractCheck } from "./contract-check.js";
import { secretStoreContract } from "./secret-store-contract.js";

describe("secret store contract", () => {
  it("fails a store that answers every name with the same value and keeps nothing", async () => {
    const checks = secretStoreContract({
      create: async () => ({
        read: async () => ok(createSecret("same")),
        write: async () => undefined,
        delete: async () => ok(undefined),
      }),
    });
    const results = await Promise.allSettled(
      checks.map(async (check: ContractCheck) => check.run()),
    );
    expect(
      results.map((result: Readonly<PromiseSettledResult<void>>) => result.status),
    ).toStrictEqual(checks.map(() => "rejected"));
    expect(checks).toHaveLength(9);
  });
});
