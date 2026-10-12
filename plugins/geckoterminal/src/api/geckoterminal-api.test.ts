import { BinferenceError, type HttpRequest, type HttpResponse } from "@binference/plugin-sdk";
import { createManualClock, type ManualClock } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  tokenNotFoundAnswer,
  tooManyAddressesAnswer,
  trendingPoolsAnswer,
  wbnbAddress,
  wbnbDeepestPool,
  wbnbOhlcvAnswer,
  wbnbPoolsAnswer,
  wbnbTokensAnswer,
} from "../testing/recorded-answers.js";
import { createGeckoterminalApi } from "./geckoterminal-api.js";

const origin = "https://api.geckoterminal.com/api/v2";
const poolsUrl = `${origin}/networks/bsc/tokens/${wbnbAddress}/pools`;
const trendingUrl = `${origin}/networks/bsc/trending_pools`;
const priceUrl = `${origin}/networks/bsc/tokens/multi/${wbnbAddress}`;
const ohlcvUrl =
  `${origin}/networks/bsc/pools/${wbnbDeepestPool}/ohlcv/hour?aggregate=4&limit=3&currency=usd` +
  `&token=${wbnbAddress.toLowerCase()}&include_empty_intervals=true`;
const startMs = Date.UTC(2026, 9, 12, 9, 0, 0);
const live = (): AbortSignal => new AbortController().signal;
const hourQuery = {
  network: "bsc",
  pool: wbnbDeepestPool,
  timeframe: "hour" as const,
  aggregate: 4,
  limit: 3,
  token: wbnbAddress,
};

function answer(body: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

const tooMany = (headers: Record<string, string> = {}): HttpResponse =>
  answer('{"status":{"error_code":429,"error_message":"Too Many Requests"}}', 429, headers);

/** An Http adapter that answers each URL from its queue in turn, its last answer from then on. */
function queuedHttp(queues: Readonly<Record<string, readonly HttpResponse[]>>) {
  const requests: HttpRequest[] = [];
  const served = new Map<string, number>();
  return {
    requests,
    async request(request: HttpRequest): Promise<HttpResponse> {
      request.signal.throwIfAborted();
      requests.push(request);
      const queue = queues[request.url] ?? [];
      const index = served.get(request.url) ?? 0;
      served.set(request.url, index + 1);
      const response = queue[Math.min(index, queue.length - 1)];
      return await Promise.resolve(response ?? answer(tokenNotFoundAnswer, 404));
    },
  };
}

function apiOver(queues: Readonly<Record<string, readonly HttpResponse[]>>, maxWaitMs = 60_000) {
  const http = queuedHttp(queues);
  const clock = createManualClock(startMs);
  return { http, clock, api: createGeckoterminalApi({ http, clock, maxWaitMs }) };
}

// Settles a read that waits on the manual clock, after moving the clock by `ms`.
async function after<T>(clock: ManualClock, ms: number, read: Promise<T>): Promise<T> {
  await clock.advance(ms);
  return await read;
}

describe("the GeckoTerminal API client", () => {
  it("asks each documented endpoint keyless, with the API version and the caller's signal", async () => {
    const { http, api } = apiOver({ [trendingUrl]: [answer(trendingPoolsAnswer)] });
    const signal = live();
    await expect(api.trendingPools("bsc", signal)).resolves.toHaveLength(3);
    expect(http.requests).toStrictEqual([
      {
        method: "GET",
        url: trendingUrl,
        headers: { accept: "application/json;version=20230203" },
        signal,
      },
    ]);
  });

  it("reads a token's pools, and none for the documented 404 of an unknown token", async () => {
    const { api } = apiOver({ [poolsUrl]: [answer(wbnbPoolsAnswer)] });
    const pools = await api.tokenPools("bsc", wbnbAddress, live());
    expect(pools.map((pool) => [pool.dexId, pool.reserveUsd])).toStrictEqual([
      ["pancakeswap-v3-bsc", "15727097.1765"],
      ["pancakeswap_v2", "58334444.3085"],
      ["pancakeswap-v3-bsc", "28019090.5434"],
    ]);
    const unknown = "0x000000000000000000000000000000000000dEaD";
    await expect(api.tokenPools("bsc", unknown, live())).resolves.toStrictEqual([]);
  });

  it("asks for a pool's candles in USD for the token, every interval, its numbers as text", async () => {
    const { http, api } = apiOver({ [ohlcvUrl]: [answer(wbnbOhlcvAnswer)] });
    const ohlcv = await api.ohlcv(hourQuery, live());
    expect(http.requests.map(({ url }) => url)).toStrictEqual([ohlcvUrl]);
    expect(ohlcv.baseAddress).toBe(wbnbAddress.toLowerCase());
    expect(ohlcv.rows[0]).toStrictEqual({
      timestamp: "1791792000",
      open: "753.96",
      high: "753.972475788138",
      low: "750.83",
      close: "750.99",
      volume: "506069.0699224211",
    });
  });

  it("asks for candles before a time and never more than 1,000 at once", async () => {
    const url =
      `${origin}/networks/bsc/pools/${wbnbDeepestPool}/ohlcv/minute?aggregate=15&limit=1000` +
      `&currency=usd&token=${wbnbAddress.toLowerCase()}&include_empty_intervals=true` +
      `&before_timestamp=1791792000`;
    const { http, api } = apiOver({ [url]: [answer(wbnbOhlcvAnswer)] });
    const query = { ...hourQuery, timeframe: "minute" as const, aggregate: 15, limit: 5_000 };
    await api.ohlcv({ ...query, beforeTimestamp: 1_791_792_000 }, live());
    expect(http.requests.map((request) => request.url)).toStrictEqual([url]);
  });

  it("reads prices by lowercase address, at most 30 addresses a request, in order", async () => {
    const addresses = Array.from(
      { length: 31 },
      (_each, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`,
    );
    const first = `${origin}/networks/bsc/tokens/multi/${addresses.slice(0, 30).join(",")}`;
    const second = `${origin}/networks/bsc/tokens/multi/${addresses.slice(30).join(",")}`;
    const { http, api } = apiOver({
      [first]: [answer(wbnbTokensAnswer)],
      [second]: [
        answer('{"data":[{"type":"token","attributes":{"address":"0xABC","price_usd":null}}]}'),
      ],
    });
    const prices = await api.tokenPrices("bsc", addresses, live());
    expect([...prices]).toStrictEqual([[wbnbAddress.toLowerCase(), "750.08"]]);
    expect(http.requests.map(({ url }) => url)).toStrictEqual([first, second]);
  });

  it("waits the seconds a 429's Retry-After names, then asks once more", async () => {
    const { http, clock, api } = apiOver({
      [priceUrl]: [tooMany({ "retry-after": "3" }), answer(wbnbTokensAnswer)],
    });
    const read = api.tokenPrices("bsc", [wbnbAddress], live());
    await clock.advance(2_999);
    expect(http.requests).toHaveLength(1);
    await expect(after(clock, 1, read)).resolves.toHaveProperty("size", 1);
    expect(http.requests).toHaveLength(2);
  });

  it("pauses every endpoint for the limit's whole minute after a 429 that names no wait", async () => {
    const { http, clock, api } = apiOver({
      [trendingUrl]: [tooMany(), answer(trendingPoolsAnswer)],
      [poolsUrl]: [answer(wbnbPoolsAnswer)],
    });
    const trending = api.trendingPools("bsc", live());
    await clock.advance(0);
    const pools = api.tokenPools("bsc", wbnbAddress, live());
    await clock.advance(59_999);
    expect(http.requests.map(({ url }) => url)).toStrictEqual([trendingUrl]);
    await clock.advance(1);
    await expect(Promise.all([trending, pools])).resolves.toHaveLength(2);
    expect(http.requests).toHaveLength(3);
  });

  it("fails rate limited on a second 429, with the wait it names", async () => {
    const { clock, api } = apiOver({
      [trendingUrl]: [tooMany({ "retry-after": "1" }), tooMany({ "retry-after": "45" })],
    });
    const read = api.trendingPools("bsc", live());
    await expect(after(clock, 1_000, read)).rejects.toMatchObject({
      code: "geckoterminal.rate_limited",
      retryable: true,
      details: { retryAfterMs: 45_000 },
    });
  });

  it("fails rate limited at once when a 429's pause is past the longest wait", async () => {
    const { http, api } = apiOver(
      { [trendingUrl]: [tooMany(), answer(trendingPoolsAnswer)] },
      10_000,
    );
    await expect(api.trendingPools("bsc", live())).rejects.toMatchObject({
      code: "geckoterminal.rate_limited",
      details: { retryAfterMs: 60_000 },
    });
    expect(http.requests).toHaveLength(1);
  });

  it("sends no more than the published 10 requests a minute: the 11th waits for the window", async () => {
    const { http, clock, api } = apiOver({ [trendingUrl]: [answer(trendingPoolsAnswer)] });
    await Promise.all(Array.from({ length: 10 }, async () => api.trendingPools("bsc", live())));
    const eleventh = api.trendingPools("bsc", live());
    await clock.advance(59_999);
    expect(http.requests).toHaveLength(10);
    await expect(after(clock, 1, eleventh)).resolves.toHaveLength(3);
    expect(http.requests).toHaveLength(11);
  });

  it.each([
    { name: "a request for more than 30 tokens", status: 400, body: tooManyAddressesAnswer },
    { name: "a request the server blocks", status: 403, body: "<html>blocked</html>" },
    { name: "an unknown network", status: 404, body: tokenNotFoundAnswer },
  ])("fails as unavailable, not to be asked again, on $name", async ({ status, body }) => {
    const { api } = apiOver({ [priceUrl]: [answer(body, status)] });
    await expect(api.tokenPrices("bsc", [wbnbAddress], live())).rejects.toMatchObject({
      code: "geckoterminal.unavailable",
      retryable: false,
      details: { status },
    });
  });

  it.each([408, 500, 503])(
    "fails as unavailable, worth asking again, on HTTP %i",
    async (status) => {
      const { api } = apiOver({ [priceUrl]: [answer("", status)] });
      await expect(api.tokenPrices("bsc", [wbnbAddress], live())).rejects.toMatchObject({
        code: "geckoterminal.unavailable",
        retryable: true,
        details: { status },
      });
    },
  );

  it.each([
    ["text that is not JSON", poolsUrl, "<html>Checking your browser</html>"],
    ["a list where an object belongs", poolsUrl, "[]"],
    ["a pool without its address", poolsUrl, wbnbPoolsAnswer.replaceAll('"address"', '"addr"')],
    [
      "a figure that is not a number",
      poolsUrl,
      wbnbPoolsAnswer.replace('"750.99"', '"about"').replace('"15727097.1765"', '"lots"'),
    ],
    [
      "an OHLCV row of five figures",
      ohlcvUrl,
      wbnbOhlcvAnswer.replace(", 506069.0699224211]", "]"),
    ],
    ["a price that is not a number", priceUrl, wbnbTokensAnswer.replace('"750.08"', '"750.08x"')],
  ])("fails as a bad answer on %s", async (_case, url, body) => {
    const { api } = apiOver({ [url]: [answer(body)] });
    const reads: Record<string, () => Promise<object>> = {
      [poolsUrl]: async () => api.tokenPools("bsc", wbnbAddress, live()),
      [ohlcvUrl]: async () => api.ohlcv(hourQuery, live()),
      [priceUrl]: async () => api.tokenPrices("bsc", [wbnbAddress], live()),
    };
    const read = reads[url]?.();
    await expect(read).rejects.toBeInstanceOf(BinferenceError);
    await expect(read).rejects.toMatchObject({
      code: "geckoterminal.bad_answer",
      retryable: false,
    });
  });

  it("refuses to put anything but an id or an address in a path", async () => {
    const { http, api } = apiOver({});
    await expect(api.tokenPools("bsc", "0xabc/../../x", live())).rejects.toMatchObject({
      code: "geckoterminal.bad_request",
    });
    expect(http.requests).toHaveLength(0);
  });
});
