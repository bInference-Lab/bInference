import { assetRefSchema } from "@binference/chain";
import { bpsSchema } from "@binference/core";
import type { IntentRequest } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { testAgent, testCoin, testLimits, testToken, testWallet } from "../intents/test-intents.js";
import { testChains } from "../operations/test-engine.js";
import { testSend } from "../sends/test-transfers.js";
import { tradeAskOf } from "./swap-trade.js";

const context = { limits: testLimits, chains: testChains() };
const unlisted = assetRefSchema.parse("fake:1/token:0x000000c1");
const nowhere = assetRefSchema.parse("fake:9/token:0x000000c1");
const asked = { agent: testAgent, wallet: testWallet, reason: "Trade" } as const;

function buy(spend: typeof testCoin, token = testToken): IntentRequest {
  return { ...asked, kind: "buy", token, spend: { asset: spend, base: 5n } };
}

function sell(receive?: typeof testCoin): IntentRequest {
  const sale = { ...asked, kind: "sell", token: testToken, amount: { base: 5n } } as const;
  return receive === undefined ? sale : { ...sale, receive };
}

describe("reading a trade for the money path", () => {
  it("reads a buy that spends the coin, with the slippage it asks", () => {
    const request = { ...buy(testCoin), maxSlippageBps: bpsSchema.parse(50) };
    expect(tradeAskOf(request, context)).toStrictEqual({
      ok: true,
      value: {
        kind: "buy",
        assetIn: testCoin,
        amount: { base: 5n },
        assetOut: testToken,
        placed: testToken,
        maxSlippageBps: 50,
      },
    });
  });

  it("refuses a buy that spends a token the registry does not list, or an asset with no form", () => {
    expect(tradeAskOf(buy(unlisted), context)).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
    expect(tradeAskOf(buy(testCoin, nowhere), context)).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });

  it("reads a sale for the coin it names, or for whatever the venue pays", () => {
    const sale = { kind: "sell", assetIn: testToken, amount: { base: 5n }, placed: testToken };
    expect(tradeAskOf(sell(testCoin), context)).toStrictEqual({
      ok: true,
      value: { ...sale, assetOut: testCoin },
    });
    expect(tradeAskOf(sell(), context)).toStrictEqual({ ok: true, value: sale });
    expect(tradeAskOf(sell(nowhere), context)).toStrictEqual({
      ok: false,
      error: "protocol.bad_args",
    });
  });

  it("refuses a swap of an asset with no form on a chain the registry holds", () => {
    const swap = {
      ...asked,
      kind: "swap",
      from: testCoin,
      to: nowhere,
      amount: { base: 5n },
    } as const;
    expect(tradeAskOf(swap, context)).toStrictEqual({ ok: false, error: "protocol.bad_args" });
  });

  it("routes nothing for an agent with no venue, or a request that is not a trade", () => {
    const noVenue = { ...context, limits: { ...testLimits, venues: [] } };
    expect(tradeAskOf(buy(testCoin), noVenue)).toStrictEqual({ ok: false, error: "no_route" });
    expect(tradeAskOf(testSend(), context)).toStrictEqual({ ok: false, error: "no_route" });
  });
});
