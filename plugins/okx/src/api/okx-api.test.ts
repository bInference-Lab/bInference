import { createHmac } from "node:crypto";
import { BinferenceError } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { nativeToken, usdtToken } from "../testing/dag-fixtures.js";
import { errorAnswer, liquidityAnswer, quoteAnswer } from "../testing/okx-answers.js";
import {
  answer,
  fixedClock,
  okxUrl,
  quotedAtMs,
  scriptedApi,
  testKeys,
} from "../testing/venue-fixtures.js";
import { createOkxApi, type RouteQuery } from "./okx-api.js";

const live = (): AbortSignal => new AbortController().signal;
const query: RouteQuery = {
  chainIndex: "56",
  tokenIn: nativeToken,
  tokenOut: usdtToken,
  amountIn: 10n ** 17n,
  excludedDexIds: [],
};
const quoteUrl = okxUrl("/quote", {
  chainIndex: "56",
  amount: "100000000000000000",
  fromTokenAddress: nativeToken.toLowerCase(),
  toTokenAddress: usdtToken.toLowerCase(),
});
const route = {
  tokenIn: nativeToken,
  tokenOut: usdtToken,
  amountIn: 10n ** 17n,
  amountOut: 74n * 10n ** 18n,
  sources: ["PancakeSwap V3"],
};

function apiOver(response: ReturnType<typeof quoteAnswer>) {
  const http = scriptedApi({ [quoteUrl]: response });
  return { http, api: createOkxApi({ http, clock: fixedClock, keys: testKeys }) };
}

async function faultOf(response: ReturnType<typeof quoteAnswer>): Promise<BinferenceError> {
  const { api } = apiOver(response);
  const error: unknown = await api.quote(query, live()).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(BinferenceError);
  return error as BinferenceError;
}

describe("okx api", () => {
  it("signs each GET as OKX's authentication guide says: timestamp, method, path and query", async () => {
    const { http, api } = apiOver(quoteAnswer(route));
    await api.quote(query, live());
    const [request] = http.requests();
    const timestamp = new Date(quotedAtMs).toISOString();
    const pathAndQuery = quoteUrl.slice("https://web3.okx.com".length);
    const signature = createHmac("sha256", "test-secret-key")
      .update(`${timestamp}GET${pathAndQuery}`)
      .digest("base64");
    expect(request?.headers).toStrictEqual({
      "OK-ACCESS-KEY": "test-api-key",
      "OK-ACCESS-SIGN": signature,
      "OK-ACCESS-TIMESTAMP": "2026-10-08T18:13:20.000Z",
      "OK-ACCESS-PASSPHRASE": "test-passphrase",
    });
  });

  it("reads a quote into the venue's types, checksum addresses and base units", async () => {
    const { api } = apiOver(quoteAnswer({ ...route, sources: ["Uniswap V3", "Uniswap V3"] }));
    await expect(api.quote(query, live())).resolves.toStrictEqual({
      ok: true,
      value: {
        tokenIn: nativeToken,
        tokenOut: usdtToken,
        amountIn: 10n ** 17n,
        amountOut: 74n * 10n ** 18n,
        priceImpactPercent: "-0.05",
        sources: ["Uniswap V3"],
      },
    });
  });

  it("asks for a route without the DEX ids it must not use", async () => {
    const excluded = okxUrl("/quote", {
      chainIndex: "56",
      amount: "100000000000000000",
      fromTokenAddress: nativeToken.toLowerCase(),
      toTokenAddress: usdtToken.toLowerCase(),
      excludeDexIds: "190,200",
    });
    const http = scriptedApi({ [excluded]: quoteAnswer(route) });
    const api = createOkxApi({ http, clock: fixedClock, keys: testKeys });
    const found = await api.quote({ ...query, excludedDexIds: ["190", "200"] }, live());
    expect(found.ok).toBe(true);
  });

  it.each(["82000", "82102", "82103", "82104", "82112"])(
    "reads OKX's code %s as no route",
    async (code) => {
      const { api } = apiOver(errorAnswer(code));
      await expect(api.quote(query, live())).resolves.toStrictEqual({
        ok: false,
        error: "no_route",
      });
    },
  );

  it.each(
    (
      [
        ["50011", 429, "okx.rate_limited", true],
        ["80000", 200, "okx.rate_limited", true],
        ["50026", 500, "okx.unavailable", true],
        ["80001", 200, "okx.unavailable", true],
        ["82001", 500, "okx.unavailable", true],
        ["82116", 200, "okx.unavailable", true],
        ["50112", 401, "okx.clock_skew", true],
        ["50103", 401, "okx.bad_key", false],
        ["50104", 401, "okx.bad_key", false],
        ["50105", 401, "okx.bad_key", false],
        ["50106", 401, "okx.bad_key", false],
        ["50107", 401, "okx.bad_key", false],
        ["50111", 401, "okx.bad_key", false],
        ["50113", 401, "okx.bad_key", false],
        ["50014", 400, "okx.bad_request", false],
        ["51000", 400, "okx.bad_request", false],
        ["80002", 200, "okx.bad_request", false],
        ["80003", 200, "okx.bad_request", false],
        ["80004", 200, "okx.bad_request", false],
        ["80005", 200, "okx.bad_request", false],
        ["82003", 200, "okx.bad_request", false],
        ["82004", 200, "okx.bad_request", false],
        ["82005", 200, "okx.bad_request", false],
        ["82105", 200, "okx.bad_request", false],
        ["82130", 200, "okx.bad_request", false],
      ] as const
    ).map(([code, status, faultCode, retryable]) => ({ code, status, faultCode, retryable })),
  )(
    "throws on OKX's code $code (HTTP $status) as $faultCode, naming the code",
    async ({ code, status, faultCode, retryable }) => {
      const error = await faultOf(errorAnswer(code, status));
      expect(error.code).toBe(faultCode);
      expect(error.retryable).toBe(retryable);
      expect(error.details).toStrictEqual({ status, answer: code });
    },
  );

  it.each([
    [429, "okx.rate_limited"],
    [401, "okx.bad_key"],
    [503, "okx.unavailable"],
    [404, "okx.unavailable"],
  ] as const)("throws on HTTP %i without a code as %s", async (status, faultCode) => {
    const error = await faultOf({ status, headers: {}, body: "Too many requests" });
    expect(error.code).toBe(faultCode);
    expect(error.details).toStrictEqual({ status, answer: "none" });
  });

  it.each([
    ["an unknown code", errorAnswer("99999")],
    ["a success with no route in it", answer({ code: "0", data: [], msg: "" })],
    ["a route with a broken amount", answer({ code: "0", data: [{ fromTokenAmount: "1e18" }] })],
  ])("throws the unavailable fault on %s", async (_label, response) => {
    const error = await faultOf(response);
    expect(error.code).toBe("okx.unavailable");
  });

  it("never puts the key, its secret or its passphrase in a fault", async () => {
    const error = await faultOf(errorAnswer("50113", 401));
    const shown = JSON.stringify({ message: error.message, details: error.details });
    expect(shown).not.toMatch(/test-api-key|test-secret-key|test-passphrase|answer text/);
  });

  it("lists the liquidity protocols of a chain, and throws when OKX gives none", async () => {
    const url = okxUrl("/get-liquidity", { chainIndex: "56" });
    const http = scriptedApi({ [url]: liquidityAnswer([["190", "PancakeSwap Infinity CL"]]) });
    const api = createOkxApi({ http, clock: fixedClock, keys: testKeys });
    await expect(api.liquidity("56", live())).resolves.toStrictEqual([
      { id: "190", name: "PancakeSwap Infinity CL" },
    ]);
    const refusing = scriptedApi({ [url]: errorAnswer("82000") });
    const refused = createOkxApi({ http: refusing, clock: fixedClock, keys: testKeys });
    await expect(refused.liquidity("56", live())).rejects.toMatchObject({
      code: "okx.unavailable",
      details: { answer: "82000" },
    });
  });

  it("passes the caller's signal to every request", async () => {
    const { http, api } = apiOver(quoteAnswer(route));
    const signal = live();
    await api.quote(query, signal);
    expect(http.requests().map((request) => request.signal)).toStrictEqual([signal]);
  });
});
