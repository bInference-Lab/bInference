import { describe, expect, it } from "vitest";
import { testCoin, testToken } from "../intents/test-intents.js";
import { settledAfterOf } from "./settling-receipt.js";

const confirmed = {
  outcome: "confirmed",
  answeredBy: { surface: "console", by: "dev_1" },
  atMs: 1,
} as const;
const fill = { amountIn: { asset: testCoin, base: 1n }, amountOut: { asset: testToken, base: 2n } };
const coinInfo = { [testCoin]: { symbol: "FAKE", name: "Fake", decimals: 18, verified: true } };
const tokenInfo = { [testToken]: { symbol: "TKN", name: "Token", decimals: 6, verified: true } };

describe("what followed a closed card", () => {
  it("is the paper fill, flagged as paper, before any other", () => {
    const settling = {
      ref: "r",
      closing: confirmed,
      paper: { fill, assets: coinInfo },
      live: { outcome: { kind: "done" }, assets: tokenInfo },
    } as const;
    expect(settledAfterOf(settling)).toStrictEqual({
      after: { kind: "paper", fill },
      assets: { ...tokenInfo, ...coinInfo },
    });
  });

  it("is what a card took effect as, else how it ended on chain", () => {
    const written = {
      outcome: { kind: "orderUnstarted", why: "expired" },
      assets: coinInfo,
    } as const;
    const live = { outcome: { kind: "done" }, assets: tokenInfo } as const;
    expect(settledAfterOf({ ref: "r", closing: confirmed, written, live }).after).toStrictEqual(
      written.outcome,
    );
    expect(settledAfterOf({ ref: "r", closing: confirmed, live })).toStrictEqual({
      after: live.outcome,
      assets: tokenInfo,
    });
  });

  it("is nothing while the card is still sending", () => {
    expect(settledAfterOf({ ref: "r", closing: confirmed })).toStrictEqual({ assets: {} });
  });
});
