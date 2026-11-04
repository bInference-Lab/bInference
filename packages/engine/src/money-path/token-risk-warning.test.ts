import { type AssetRef, assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { RiskView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { quoteDocument, riskDocument } from "../intents/intent-documents.schema.js";
import { testCoin, testNowMs, testToken } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { hasTokenRiskWarning, measuredTaxOf } from "./token-risk-warning.js";

const unlisted = assetRefSchema.parse("fake:1/token:0x0000000f");
const clean: RiskView = { verdict: "pass", flags: [], onCurve: false, checkedAt: testNowMs };

function quoteBuying(asset: AssetRef) {
  return quoteDocument.encode({
    route: [],
    amountIn: { asset: testCoin, base: 10n ** 17n },
    expectedOut: { asset, base: 2_000_000n },
    minOut: { asset, base: 1_990_000n },
    priceImpactBps: bpsSchema.parse(0),
    gas: { asset: testCoin, base: 0n },
    quotedAt: testNowMs,
    expiresAt: testNowMs,
  });
}

function warned(bought: AssetRef, risk: RiskView | undefined): boolean {
  const record = {
    quote: quoteBuying(bought),
    ...(risk === undefined ? {} : { risk: riskDocument.encode(risk) }),
  };
  return hasTokenRiskWarning(record, testChains());
}

describe("a trade's token risk warning", () => {
  it("is none for a listed token the risk step passed clean", () => {
    expect(warned(testToken, clean)).toBe(false);
    expect(warned(testToken, undefined)).toBe(false);
  });

  it("holds for a token the registry does not list, even when every risk check passed", () => {
    expect(warned(unlisted, clean)).toBe(true);
  });

  it("holds for a listed token with a measured tax or a warning verdict", () => {
    const taxed = { ...clean, verdict: "warn", buyTaxBps: bpsSchema.parse(300) } as const;
    const flagged = { ...clean, verdict: "warn", flags: [{ code: "mintable", source: "a" }] };
    expect(warned(testToken, taxed)).toBe(true);
    expect(warned(testToken, flagged as RiskView)).toBe(true);
  });

  it("holds when the trade stored no quote, so a doubt asks", () => {
    expect(hasTokenRiskWarning({}, testChains())).toBe(true);
  });

  it("measures the higher of the two legs' taxes, and none without a risk view", () => {
    const risk = { ...clean, buyTaxBps: bpsSchema.parse(200), sellTaxBps: bpsSchema.parse(500) };
    expect(measuredTaxOf({ risk: riskDocument.encode(risk) })).toBe(500);
    expect(measuredTaxOf({})).toBeUndefined();
  });
});
