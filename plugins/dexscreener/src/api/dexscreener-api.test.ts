import { BinferenceError, type HttpRequest, type HttpResponse } from "@binference/plugin-sdk";
import { createManualClock, type ManualClock } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { topBoostsAnswer, wbnbAddress, wbnbPairsAnswer } from "../testing/recorded-answers.js";
import { createDexscreenerApi } from "./dexscreener-api.js";

const origin = "https://api.dexscreener.com";
const boostsUrl = `${origin}/token-boosts/top/v1`;
const pairsUrl = `${origin}/token-pairs/v1/bsc/${wbnbAddress}`;
const startMs = Date.UTC(2026, 9, 12, 6, 0, 0);
const live = (): AbortSignal => new AbortController().signal;

function answer(body: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers: { "content-type": "application/json", ...headers }, body };
}

const tooMany = (headers: Record<string, string> = {}): HttpResponse =>
  answer("Too Many Requests", 429, headers);

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
      return await Promise.resolve(response ?? answer("not found", 404));
    },
  };
}

function apiOver(queues: Readonly<Record<string, readonly HttpResponse[]>>, maxWaitMs = 60_000) {
  const http = queuedHttp(queues);
  const clock = createManualClock(startMs);
  return { http, clock, api: createDexscreenerApi({ http, clock, maxWaitMs }) };
}

// Settles a read that waits on the manual clock, after moving the clock by `ms`.
async function after<T>(clock: ManualClock, ms: number, read: Promise<T>): Promise<T> {
  await clock.advance(ms);
  return await read;
}

describe("the DEX Screener API client", () => {
  it("asks each documented endpoint once, keyless, with the caller's signal", async () => {
    const { http, api } = apiOver({ [boostsUrl]: [answer(topBoostsAnswer)] });
    const signal = live();
    await expect(api.topBoosts(signal)).resolves.toHaveLength(3);
    expect(http.requests).toStrictEqual([{ method: "GET", url: boostsUrl, signal }]);
  });

  it("asks for at most 30 tokens a request, the rest in a next request, in order", async () => {
    const addresses = Array.from(
      { length: 31 },
      (_each, index) => `0x${index.toString(16).padStart(40, "0")}`,
    );
    const first = `${origin}/tokens/v1/bsc/${addresses.slice(0, 30).join(",")}`;
    const second = `${origin}/tokens/v1/bsc/${addresses.slice(30).join(",")}`;
    const { http, api } = apiOver({ [first]: [answer(wbnbPairsAnswer)], [second]: [answer("[]")] });
    await expect(api.tokens("bsc", addresses, live())).resolves.toHaveLength(3);
    expect(http.requests.map(({ url }) => url)).toStrictEqual([first, second]);
  });

  it("waits the seconds a 429's Retry-After names, then asks once more", async () => {
    const { http, clock, api } = apiOver({
      [pairsUrl]: [tooMany({ "retry-after": "2" }), answer(wbnbPairsAnswer)],
    });
    const read = api.tokenPairs("bsc", wbnbAddress, live());
    await clock.advance(1_999);
    expect(http.requests).toHaveLength(1);
    await expect(after(clock, 1, read)).resolves.toHaveLength(3);
    expect(http.requests).toHaveLength(2);
  });

  it("waits until the date a 429's Retry-After names", async () => {
    const until = new Date(startMs + 5_000).toUTCString();
    const { http, clock, api } = apiOver({
      [pairsUrl]: [tooMany({ "retry-after": until }), answer(wbnbPairsAnswer)],
    });
    const read = api.tokenPairs("bsc", wbnbAddress, live());
    await clock.advance(4_999);
    expect(http.requests).toHaveLength(1);
    await expect(after(clock, 1, read)).resolves.toHaveLength(3);
  });

  it("pauses the endpoints for the limits' whole minute after a 429 that names no wait", async () => {
    const { http, clock, api } = apiOver({ [boostsUrl]: [tooMany(), answer(topBoostsAnswer)] });
    const read = api.topBoosts(live());
    await clock.advance(59_999);
    expect(http.requests).toHaveLength(1);
    await expect(after(clock, 1, read)).resolves.toHaveLength(3);
  });

  it("fails rate limited at once when a 429's pause is past the longest wait", async () => {
    const { http, api } = apiOver({ [boostsUrl]: [tooMany(), answer(topBoostsAnswer)] }, 10_000);
    await expect(api.topBoosts(live())).rejects.toMatchObject({
      code: "dexscreener.rate_limited",
      retryable: true,
      details: { retryAfterMs: 60_000 },
    });
    expect(http.requests).toHaveLength(1);
  });

  it("fails rate limited on a second 429, and keeps its group paused for the next read", async () => {
    const { http, clock, api } = apiOver({
      [boostsUrl]: [tooMany({ "retry-after": "1" }), tooMany({ "retry-after": "30" })],
    });
    const read = api.topBoosts(live());
    await expect(after(clock, 1_000, read)).rejects.toMatchObject({
      code: "dexscreener.rate_limited",
      details: { retryAfterMs: 30_000 },
    });
    const next = api.topBoosts(live());
    await clock.advance(29_999);
    expect(http.requests).toHaveLength(2);
    await clock.advance(1);
    expect(http.requests).toHaveLength(3);
    await expect(after(clock, 30_000, next)).rejects.toMatchObject({
      code: "dexscreener.rate_limited",
    });
    expect(http.requests).toHaveLength(4);
  });

  it("sends no more than 60 boosts reads in a minute: the 61st waits for the window", async () => {
    const { http, clock, api } = apiOver({ [boostsUrl]: [answer(topBoostsAnswer)] });
    await Promise.all(Array.from({ length: 60 }, async () => api.topBoosts(live())));
    const sixtyFirst = api.topBoosts(live());
    await clock.advance(59_999);
    expect(http.requests).toHaveLength(60);
    await expect(after(clock, 1, sixtyFirst)).resolves.toHaveLength(3);
    expect(http.requests).toHaveLength(61);
  });

  it("sends no more than 300 pair reads in a minute, apart from the boosts' 60", async () => {
    const { http, clock, api } = apiOver({
      [pairsUrl]: [answer(wbnbPairsAnswer)],
      [boostsUrl]: [answer(topBoostsAnswer)],
    });
    await Promise.all(
      Array.from({ length: 300 }, async () => api.tokenPairs("bsc", wbnbAddress, live())),
    );
    await expect(api.topBoosts(live())).resolves.toHaveLength(3);
    const late = api.tokenPairs("bsc", wbnbAddress, live());
    await expect(after(clock, 60_000, late)).resolves.toHaveLength(3);
    expect(http.requests).toHaveLength(302);
  });

  it("stops a read that waits for its turn with the signal's reason", async () => {
    const { api } = apiOver({ [boostsUrl]: [tooMany(), answer(topBoostsAnswer)] });
    const controller = new AbortController();
    const reason = new Error("stopped");
    const read = api.topBoosts(controller.signal);
    controller.abort(reason);
    await expect(read).rejects.toBe(reason);
  });

  it.each([
    ["a server error", 503, true],
    ["a timeout", 408, true],
    ["a refused request", 400, false],
    ["an unknown path", 404, false],
  ])("fails as unavailable on %s", async (_case, status, retryable) => {
    const { api } = apiOver({ [boostsUrl]: [answer("<html></html>", status)] });
    await expect(api.topBoosts(live())).rejects.toMatchObject({
      code: "dexscreener.unavailable",
      retryable,
      details: { status },
    });
  });

  it.each([
    ["text that is not JSON", "<html>Checking your browser</html>"],
    ["an object where a list belongs", '{ "pairs": [] }'],
    ["a pair without its address", '[{ "chainId": "bsc", "dexId": "x", "baseToken": {} }]'],
    ["a figure that is not a number", wbnbPairsAnswer.replace('"752.57"', '"about 750"')],
  ])("fails as a bad answer on %s", async (_case, body) => {
    const { api } = apiOver({ [pairsUrl]: [answer(body)] });
    const read = api.tokenPairs("bsc", wbnbAddress, live());
    await expect(read).rejects.toBeInstanceOf(BinferenceError);
    await expect(read).rejects.toMatchObject({ code: "dexscreener.bad_answer", retryable: false });
  });

  it("refuses to put anything but an id or an address in a path", async () => {
    const { http, api } = apiOver({});
    await expect(api.tokenPairs("bsc", "0xabc/../../x", live())).rejects.toMatchObject({
      code: "dexscreener.bad_request",
    });
    expect(http.requests).toHaveLength(0);
  });
});
