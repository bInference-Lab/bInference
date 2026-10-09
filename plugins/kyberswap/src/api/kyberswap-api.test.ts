import type { HttpResponse } from "@binference/plugin-sdk";
import { successOf } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { buyRoute } from "../testing/recorded-buy.js";
import { noRouteAnswer } from "../testing/recorded-routes.js";
import { answer, buildUrl, buyRoutesUrl, scriptedApi } from "../testing/venue-fixtures.js";
import { createKyberswapApi, type RouteQuery } from "./kyberswap-api.js";

const live = (): AbortSignal => new AbortController().signal;
const query: RouteQuery = {
  slug: "bsc",
  tokenIn: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  tokenOut: "0x55d398326f99059fF775485246999027B3197955",
  amountIn: 10n ** 17n,
  excludedSources: [],
};
const order = {
  slug: "bsc",
  summary: '{"routeID":"r"}',
  wallet: "0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",
  deadlineSec: 1_791_378_457,
  slippageBps: 50,
} as const;

function apiAnswering(url: string, response: HttpResponse) {
  const http = scriptedApi({ [url]: response });
  return { http, api: createKyberswapApi({ http, clientId: "binference" }) };
}

function errorAnswer(code: number): string {
  return JSON.stringify({ code, message: "refused", requestId: "r" });
}

describe("kyberswap's aggregator api", () => {
  it("asks for a route with the trade's tokens and amount, and the sources to leave out", async () => {
    const url = `${buyRoutesUrl}&excludedSources=pancake-infinity-cl-fairflow%2Cuniswap-v4`;
    const { api, http } = apiAnswering(url, answer(buyRoute));
    const excludedSources = ["pancake-infinity-cl-fairflow", "uniswap-v4"];
    const found = await api.findRoute({ ...query, excludedSources }, live());
    expect(successOf(found).amountOut).toBe(76_705_221_475_414_064_061n);
    expect(http.requests().map((request) => request.headers)).toStrictEqual([
      { "x-client-id": "binference" },
    ]);
  });

  it.each([4008, 4009, 4010, 4011, 40011])("reads answer code %i as no route", async (code) => {
    const { api } = apiAnswering(buyRoutesUrl, answer(errorAnswer(code), 400));
    await expect(api.findRoute(query, live())).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it.each<[string, HttpResponse, boolean]>([
    ["a bad request", answer(errorAnswer(4001), 400), false],
    ["no route at another status", answer(noRouteAnswer, 404), false],
    ["a found route it cannot read", answer('{"code":0,"data":{}}'), false],
    ["text that is no JSON", answer("<html>busy</html>", 502), true],
    ["too many requests", answer(errorAnswer(4290), 429), true],
  ])("throws on %s", async (_case, response, retryable) => {
    const { api } = apiAnswering(buyRoutesUrl, response);
    await expect(api.findRoute(query, live())).rejects.toMatchObject({
      code: "kyberswap.unavailable",
      retryable,
    });
  });

  it("posts the route summary back unchanged, for the wallet, with the deadline and slippage", async () => {
    const { api, http } = apiAnswering(buildUrl, answer("{}"));
    await expect(api.buildRoute(order, live())).rejects.toMatchObject({
      code: "kyberswap.unavailable",
    });
    expect(http.requests().map((request) => request.body)).toStrictEqual([
      '{"routeSummary":{"routeID":"r"},"sender":"0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",' +
        '"recipient":"0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e","deadline":1791378457,' +
        '"slippageTolerance":50,"source":"binference"}',
    ]);
  });

  it("rejects with the signal's reason once it aborts", async () => {
    const { api } = apiAnswering(buyRoutesUrl, answer(buyRoute));
    const reason = new Error("stopped");
    await expect(api.findRoute(query, AbortSignal.abort(reason))).rejects.toBe(reason);
  });
});
