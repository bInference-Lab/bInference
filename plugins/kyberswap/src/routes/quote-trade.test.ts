import { accountRefSchema, assetRefSchema, type HttpResponse } from "@binference/plugin-sdk";
import { successOf } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { buyRoute } from "../testing/recorded-buy.js";
import { hookedRoute, hooklessRoute, noRouteAnswer } from "../testing/recorded-routes.js";
import { sellRoute } from "../testing/recorded-sell.js";
import {
  answer,
  bnb,
  buyRequest,
  buyRoutesUrl,
  scriptedApi,
  sellRequest,
  sellRoutesUrl,
  venueOver,
} from "../testing/venue-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const fairflowHook = "0x44428C6ce391915D51F963C0Dd395Cd0f95fdFD2";
const withoutFairflow = `${buyRoutesUrl}&excludedSources=pancake-infinity-cl-fairflow`;
const recordedSummary = /"routeSummary": (\{[\s\S]*\}),\s*"routerAddress": "0x6131B5fa/;

// The route summary as the recorded answer writes it, compacted as the venue keeps it.
function summaryIn(route: string): string {
  const match = recordedSummary.exec(route);
  if (match?.[1] === undefined) {
    throw new Error("The recorded answer holds no route summary.");
  }
  return JSON.stringify(JSON.parse(match[1]));
}

async function quoteWith(answers: Readonly<Record<string, HttpResponse>>, hooks: string[] = []) {
  const http = scriptedApi(answers);
  const quote = await venueOver(http, hooks).quote(buyRequest, { signal: live() });
  return { quote, urls: http.requests().map((request) => request.url) };
}

describe("quotes on kyberswap", () => {
  it("quotes the route KyberSwap found and keeps it, unchanged, for the build", async () => {
    const { quote, urls } = await quoteWith({ [buyRoutesUrl]: answer(buyRoute) });
    expect(quote).toStrictEqual({
      ok: true,
      value: {
        expectedOut: { asset: buyRequest.assetOut, base: 76_705_221_475_414_064_061n },
        priceImpactBps: 5,
        route: summaryIn(buyRoute),
      },
    });
    expect(urls).toStrictEqual([buyRoutesUrl]);
  });

  it("quotes a token sale for the chain's coin", async () => {
    const http = scriptedApi({ [sellRoutesUrl]: answer(sellRoute) });
    const quote = successOf(await venueOver(http).quote(sellRequest, { signal: live() }));
    expect(quote.expectedOut).toStrictEqual({ asset: bnb, base: 65_171_490_641_067_568n });
    expect(quote.priceImpactBps).toBe(1);
  });

  it("drops a route through an unlisted hook and quotes the route without its pools", async () => {
    const { quote, urls } = await quoteWith({
      [buyRoutesUrl]: answer(hookedRoute),
      [withoutFairflow]: answer(hooklessRoute),
    });
    expect(urls).toStrictEqual([buyRoutesUrl, withoutFairflow]);
    expect(successOf(quote).expectedOut.base).toBe(76_697_414_709_402_514_376n);
    expect(successOf(quote).route).toBe(summaryIn(hooklessRoute));
  });

  it("keeps a route through a hook on the allowlist, in any letter case", async () => {
    const answers = { [buyRoutesUrl]: answer(hookedRoute) };
    const { quote, urls } = await quoteWith(answers, [fairflowHook.toLowerCase()]);
    expect(urls).toStrictEqual([buyRoutesUrl]);
    expect(successOf(quote).expectedOut.base).toBe(73_330_472_622_321_619_266n);
  });

  it.each([
    ["still passes an unlisted hook", answer(hookedRoute)],
    ["finds no route", answer(noRouteAnswer, 400)],
  ])("answers no route when the second ask %s", async (_case, second) => {
    const answers = { [buyRoutesUrl]: answer(hookedRoute), [withoutFairflow]: second };
    const { quote, urls } = await quoteWith(answers);
    expect(quote).toStrictEqual({ ok: false, error: "no_route" });
    expect(urls).toHaveLength(2);
  });

  it("answers no route when KyberSwap has none", async () => {
    const { quote } = await quoteWith({ [buyRoutesUrl]: answer(noRouteAnswer, 400) });
    expect(quote).toStrictEqual({ ok: false, error: "no_route" });
  });

  it.each([
    ["a token on another chain", "eip155:1/erc20:0xdAC17F958D2ee523a2206206994597C13D831ec7"],
    ["a coin it does not know", "eip155:56/slip44:60"],
    [
      "KyberSwap's own name for the coin",
      "eip155:56/erc20:0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    ],
  ])("answers no route for %s, without asking KyberSwap", async (_case, asset) => {
    const http = scriptedApi({});
    const request = { ...buyRequest, assetOut: assetRefSchema.parse(asset) };
    const quote = await venueOver(http).quote(request, { signal: live() });
    expect(quote).toStrictEqual({ ok: false, error: "no_route" });
    expect(http.requests()).toStrictEqual([]);
  });

  it("answers no route for a wallet on a chain it does not trade on", async () => {
    const wallet = accountRefSchema.parse(buyRequest.wallet.replace("eip155:56:", "eip155:1:"));
    const request = { ...buyRequest, wallet };
    const quote = await venueOver(scriptedApi({})).quote(request, { signal: live() });
    expect(quote).toStrictEqual({ ok: false, error: "no_route" });
  });

  it.each([
    [
      "another router",
      buyRoute.replaceAll(
        "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
        "0x6868D319c8c9A78F7d39DC3602C5c917315132D7",
      ),
    ],
    ["another amount", buyRoute.replace('"amountIn": "100000000000000000"', '"amountIn": "1"')],
    ["another token", buyRoute.replace('"tokenOut": "0x55d3', '"tokenOut": "0x8ac7')],
    ["a fee", buyRoute.replace('"feeAmount": ""', '"feeAmount": "10"')],
  ])("refuses a route with %s", async (_case, route) => {
    await expect(quoteWith({ [buyRoutesUrl]: answer(route) })).rejects.toMatchObject({
      code: "kyberswap.bad_route",
    });
  });

  it.each([
    ["no router", {}, "kyberswap.no_contract"],
    [
      "a router that is no EVM address",
      { "meta-aggregation-router-v2": accountRefSchema.parse("eip155:56:0x0a") },
      "kyberswap.not_evm",
    ],
  ])("refuses a request whose registry contracts hold %s", async (_case, contracts, code) => {
    const http = scriptedApi({ [buyRoutesUrl]: answer(buyRoute) });
    const quoting = venueOver(http).quote({ ...buyRequest, contracts }, { signal: live() });
    await expect(quoting).rejects.toMatchObject({ code });
  });

  it("refuses to quote on an aborted signal, without asking KyberSwap", async () => {
    const http = scriptedApi({ [buyRoutesUrl]: answer(buyRoute) });
    const reason = new Error("stopped");
    const quoting = venueOver(http).quote(buyRequest, { signal: AbortSignal.abort(reason) });
    await expect(quoting).rejects.toBe(reason);
    expect(http.requests()).toStrictEqual([]);
  });
});
