import { accountRefSchema, assetRefSchema, chainRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { AssetInfos, CardLineView } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createFormatter } from "../format/create-formatter.js";
import { type CardDisplay, cardLineText } from "./card-text.js";

const usdt = assetRefSchema.parse("eip155:56/erc20:0x55d398326f99059fF775485246999027B3197955");
const pepe = assetRefSchema.parse("eip155:56/erc20:0x6982508145454Ce325dDbE47a25d4ec3d2311933");
const assets: AssetInfos = {
  [usdt]: { symbol: "USDT", name: "Tether USD", decimals: 18, verified: true },
  [pepe]: { symbol: "PEPE", name: "Pepe", decimals: 18, verified: false },
};
const display: CardDisplay = {
  formatter: createFormatter({ locale: "en", timeZone: "UTC" }),
  assets,
};
const one = 10n ** 18n;

function text(line: CardLineView): string {
  return cardLineText(line, display);
}

describe("a card line as plain text", () => {
  it("formats amounts, accounts, chains, counts and USD", () => {
    const bridge: CardLineView = {
      key: "card.bridge.action",
      values: {
        amount: { type: "amount", amount: { asset: usdt, base: 5n * one } },
        chain: { type: "chain", chain: chainRefSchema.parse("eip155:1") },
        recipient: {
          type: "account",
          account: accountRefSchema.parse("eip155:56:0xAbCdEf0123456789aBcDeF0123456789AbCdEf12"),
        },
        minutes: { type: "count", count: 3 },
      },
    };
    expect(text(bridge)).toBe("Bridge 5 USDT to eip155:1 · to 0xAbCd…Ef12 · about 3 min");
  });

  it("names an unverified token by its short address, and routes, shares and ratios", () => {
    const supply: CardLineView = {
      key: "card.lend.supply",
      values: {
        amount: { type: "amount", amount: { asset: pepe, base: one } },
        venue: { type: "text", text: "Venus" },
        hf: { type: "ratio", ratio: { numerator: 3n, denominator: 2n } },
      },
    };
    const route: CardLineView = {
      key: "card.route",
      values: {
        route: {
          type: "route",
          venue: "KyberSwap",
          legs: [
            { venue: "pancakeswap", shareBps: bpsSchema.parse(9_000) },
            { venue: "uniswap", shareBps: bpsSchema.parse(1_000) },
          ],
        },
        impact: { type: "percent", bps: bpsSchema.parse(8) },
        slippage: { type: "percent", bps: bpsSchema.parse(50) },
      },
    };
    expect([text(supply), text(route)]).toStrictEqual([
      "Supply 1 PEPE (0x6982…1933) to Venus · health factor 1.5",
      "Route  KyberSwap: pancakeswap 90.00%, uniswap 10.00% · impact 0.08% · max slippage 0.50%",
    ]);
  });

  it("cuts the agent's words, fills a time, and refuses an asset it has no info on", () => {
    const reason: CardLineView = {
      key: "card.reason",
      values: { reason: { type: "text", text: "x".repeat(300) } },
    };
    const expiry: CardLineView = {
      key: "card.expiry",
      values: { time: { type: "time", atMs: Date.UTC(2026, 9, 10, 14, 32, 5) } },
    };
    const unknown: CardLineView = {
      key: "card.stake.claim",
      values: {
        amount: {
          type: "amount",
          amount: { asset: assetRefSchema.parse("fake:1/slip44:1"), base: 1n },
        },
        validator: { type: "text", text: "v" },
      },
    };
    expect(text(reason).length).toBeLessThan(220);
    expect(text(expiry)).toBe("Expires at 14:32:05");
    expect(() => text(unknown)).toThrow(
      expect.objectContaining({ code: "engine.card_asset_unknown" }),
    );
  });
});
