import { assetRefSchema, chainRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { testCoin, testLimits, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { assetInfoOf, assetInfosOf } from "./asset-infos.js";
import { policyLimitsOf } from "./policy-facts-of.js";

describe("asset infos", () => {
  it("describe the chain's coin and its listed tokens as verified", () => {
    expect(assetInfosOf(testChains(), [testCoin, testToken])).toStrictEqual({
      [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true },
      [testToken]: { symbol: "TKN", name: "Token", decimals: 6, verified: true },
    });
  });

  it("know nothing of an unlisted token, another coin or a chain the registry does not hold", () => {
    const unknown = ["fake:1/token:0x0000000f", "fake:1/slip44:2", "fake:2/slip44:1"].map((text) =>
      assetRefSchema.parse(text),
    );
    expect(unknown.map((asset) => assetInfoOf(testChains(), asset))).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("policy limits", () => {
  it("keep no gas reserve on a chain the limits name none for", () => {
    expect(policyLimitsOf(testLimits, chainRefSchema.parse("fake:2")).gasReserveBase).toBe(0n);
    expect(policyLimitsOf(testLimits, chainRefSchema.parse("fake:1")).gasReserveBase).toBe(
      10n ** 15n,
    );
  });
});
