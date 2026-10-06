import { describe, expect, it } from "vitest";
import type { ContractCheck } from "./contract-check.js";
import { randomContract } from "./random-contract.js";

describe("random contract", () => {
  it("fails an adapter that repeats its bytes", async () => {
    const checks = randomContract({
      create: () => ({ bytes: (length) => new Uint8Array(length) }),
    });
    const results = await Promise.allSettled(
      checks.map(async (check: ContractCheck) => check.run()),
    );
    expect(
      results.map((result: Readonly<PromiseSettledResult<void>>) => result.status),
    ).toStrictEqual(["fulfilled", "rejected"]);
  });
});
