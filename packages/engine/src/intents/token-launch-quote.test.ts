import { assetRefSchema } from "@binference/chain";
import { describe, expect, it } from "vitest";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import { testChains } from "../operations/test-engine.js";
import { requestDocument } from "./intent-documents.schema.js";
import { testAgent, testCoin, testNowMs } from "./test-intents.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "./token-launch-quote.js";

const token = assetRefSchema.parse("fake:1/token:0x000000e1");

const quote: TokenLaunchQuote = {
  venue: "fake-curve",
  settings: [
    { name: "taxBps", type: "bps", value: 300 },
    { name: "taxRecipient", type: "account", value: "fake:1:0x0000000c" },
  ],
  token,
  tokenDecimals: 18,
  fee: { asset: testCoin, base: 2_000n },
  firstBuy: { spend: { asset: testCoin, base: 50n }, expectedOut: 50_000n, minOut: 49_500n },
  image: {
    contentType: "image/png",
    bytes: 11,
    sha256: "a".repeat(64) as TokenLaunchQuote["image"]["sha256"],
  },
  metadataUri: "ipfs://fake-1",
  pin: { upload: 1 },
  pinWaitUntilMs: testNowMs + 300_000,
  quotedAtMs: testNowMs,
};

describe("a token launch's quote", () => {
  it("keeps every setting it runs with through the store", () => {
    const stored = tokenLaunchQuoteDocument.encode(quote);
    expect(tokenLaunchQuoteDocument.decode(stored)).toStrictEqual(quote);
  });

  it("names the launched token by the launch's own words, unverified", () => {
    const request = requestDocument.encode({
      kind: "launchToken",
      agent: testAgent,
      reason: "Launch it",
      venue: "fake-curve",
      name: "Moon Cat",
      symbol: "MCAT",
      image: "upl_moon",
      pairWith: testCoin,
    });
    const record = {
      kind: "launchToken" as const,
      request,
      quote: tokenLaunchQuoteDocument.encode(quote),
    };
    expect(intentAssetInfos(testChains(), record, [token, testCoin])).toMatchObject({
      [token]: { symbol: "MCAT", name: "Moon Cat", decimals: 18, verified: false },
      [testCoin]: { symbol: "FAKE", verified: true },
    });
  });
});
