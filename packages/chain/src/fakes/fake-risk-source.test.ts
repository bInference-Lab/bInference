import { describe, expect, it } from "vitest";
import { assetRefSchema } from "../caip/asset-ref.js";
import { tokenRiskSourceContract } from "../contracts/token-risk-source-contract.js";
import { createFakeRiskSource } from "./fake-risk-source.js";

const known = assetRefSchema.parse("fake:1/token:0x0000000a");
const unknown = assetRefSchema.parse("fake:1/token:0x0000000f");
const reports = new Map([
  [known, { flags: ["mintable"], liquidityUsdMicros: 5_000_000n } as const],
]);
const live = { signal: new AbortController().signal };

describe("fake risk source", () => {
  it.each(
    tokenRiskSourceContract({
      create: () => ({
        source: createFakeRiskSource({ id: "fake", reports }),
        known,
        unknown,
        down: createFakeRiskSource({ id: "fake", reports, isDown: true }),
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("counts every check that reaches it, the refused ones too", async () => {
    const source = createFakeRiskSource({ id: "fake", reports, isDown: true });
    await expect(source.check(known, live)).rejects.toMatchObject({ code: "fake.unavailable" });
    await expect(source.check(unknown, live)).rejects.toMatchObject({ retryable: true });
    expect(source.checks()).toBe(2);
  });
});
