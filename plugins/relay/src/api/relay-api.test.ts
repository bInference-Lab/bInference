import { type Clock, createSecret } from "@binference/plugin-sdk";
import { createScriptedHttp } from "@binference/plugin-sdk/testing";
import type { Hex } from "viem";
import { describe, expect, it } from "vitest";
import tooLow from "../testing/recorded/error-amount-too-low.json" with { type: "json" };
import blockedWallet from "../testing/recorded/error-blocked-wallet.json" with { type: "json" };
import noLiquidity from "../testing/recorded/error-insufficient-liquidity.json" with { type: "json" };
import invalidAddress from "../testing/recorded/error-invalid-address.json" with { type: "json" };
import invalidCurrency from "../testing/recorded/error-invalid-currency.json" with { type: "json" };
import usdcToBase from "../testing/recorded/quote-usdc-base.json" with { type: "json" };
import fillBase from "../testing/recorded/request-fill-base.json" with { type: "json" };
import rateLimited from "../testing/recorded/request-rate-limited.json" with { type: "json" };
import unseen from "../testing/recorded/request-unseen.json" with { type: "json" };
import { answerKindOf } from "./answer-fault.js";
import {
  createRelayApi,
  type QuoteBody,
  quoteRetryMs,
  quoteUrl,
  type RelayApi,
  requestsUrlOf,
} from "./relay-api.js";

const body: QuoteBody = {
  user: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
  originChainId: 56,
  destinationChainId: 8453,
  originCurrency: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  destinationCurrency: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  amount: "20000000000000000000",
  tradeType: "EXACT_INPUT",
  refundTo: "0x1111111111111111111111111111111111111111",
  refundOnOrigin: true,
  includeProtocolData: true,
  slippageTolerance: "0",
  ttl: 3600,
};
const hash: Hex = "0x1bf6374e215d2c42b383149994fdc749435db9f7b5fdcf25c1cea0ef873a04ca";
const signal = new AbortController().signal;
const json = (value: unknown): string => JSON.stringify(value);

function apiAnswering(status: number, text: string, key?: string) {
  const response = { status, headers: {}, body: text };
  const http = createScriptedHttp([
    { method: "POST", url: quoteUrl, response },
    { method: "GET", url: requestsUrlOf(hash, { keyed: key !== undefined }), response },
  ]);
  // A clock whose pauses end at once and are kept, so a test reads each wait the client took.
  const slept: number[] = [];
  const clock: Clock = {
    now: () => 0,
    sleep: async (delayMs) => {
      slept.push(delayMs);
      await Promise.resolve();
    },
  };
  const secret = key === undefined ? {} : { key: createSecret(key) };
  const api: RelayApi = createRelayApi({ http, clock, ...secret });
  return { api, http, slept };
}

describe("the Relay API client", () => {
  it("asks quote/v2 for an exact input with no slippage, refunded on BSC, with its order", async () => {
    const { api, http } = apiAnswering(200, json(usdcToBase));
    await expect(api.quote(body, signal)).resolves.toMatchObject({ ok: true });
    expect(http.requests()).toMatchObject([
      {
        url: "https://api.relay.link/quote/v2",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      },
    ]);
  });

  it("sends the owner's key as x-api-key on each request when there is one", async () => {
    const { api, http } = apiAnswering(200, json(usdcToBase), "key-1");
    await api.quote(body, signal);
    expect(http.requests()).toMatchObject([{ headers: { "x-api-key": "key-1" } }]);
  });

  it("reads requests v2 by the deposit's hash without a key, and v3 by depositTxHash with one", async () => {
    expect(requestsUrlOf(hash, { keyed: false })).toBe(
      `https://api.relay.link/requests/v2?hash=${hash}`,
    );
    expect(requestsUrlOf(hash, { keyed: true })).toBe(
      `https://api.relay.link/requests/v3?depositTxHash=${hash}`,
    );
    const { api } = apiAnswering(200, json(fillBase));
    const [request] = await api.requests(hash, signal);
    expect(request?.status).toBe("success");
    expect(request?.inTxs).toStrictEqual([{ chainId: 56n, hash }]);
  });

  it("reads a version 3 request, whose transactions name txHash and whose reasons may be null", async () => {
    const v3 = json(fillBase).replaceAll('"hash":', '"txHash":').replaceAll('"N/A"', "null");
    const { api, http } = apiAnswering(200, v3, "key-1");
    const [request] = await api.requests(hash, signal);
    expect(request?.outTxs.map((tx) => tx.chainId)).toStrictEqual([8453n]);
    expect(request?.refundFailReason).toBeUndefined();
    expect(http.requests()).toMatchObject([{ headers: { "x-api-key": "key-1" } }]);
  });

  it("answers none for a deposit Relay has not seen", async () => {
    await expect(apiAnswering(200, json(unseen)).api.requests(hash, signal)).resolves.toStrictEqual(
      [],
    );
  });

  it.each([
    ["AMOUNT_TOO_LOW", tooLow, "amount_too_low"],
    ["INSUFFICIENT_LIQUIDITY", noLiquidity, "low_liquidity"],
    ["INVALID_INPUT_CURRENCY", invalidCurrency, "no_route"],
    ["BLOCKED_WALLET_ADDRESS", blockedWallet, "no_route"],
  ])("reads the recorded %s as a reason for no route", async (_code, answer, reason) => {
    const { api } = apiAnswering(400, json(answer));
    await expect(api.quote(body, signal)).resolves.toStrictEqual({ ok: false, error: reason });
  });

  it("reads the recorded INVALID_ADDRESS as this bridge's mistake, naming Relay's code", async () => {
    const { api } = apiAnswering(400, json(invalidAddress));
    await expect(api.quote(body, signal)).rejects.toMatchObject({
      code: "relay.bad_request",
      retryable: false,
      details: { status: 400, answer: "INVALID_ADDRESS" },
    });
  });

  it.each(["PRICE_FETCH_FAILED", "REQUEST_TIMED_OUT", "RPC_HTTP_ERROR", "SERVICE_UNAVAILABLE"])(
    "asks for a quote once more after a pause when Relay answers %s, as its errors guide asks",
    async (code) => {
      const { api, http, slept } = apiAnswering(500, json({ message: "m", errorCode: code }));
      await expect(api.quote(body, signal)).rejects.toMatchObject({ code: "relay.unavailable" });
      expect([http.requests().length, slept]).toStrictEqual([2, [quoteRetryMs]]);
    },
  );

  it("asks for a quote only once when Relay's answer is no passing fault", async () => {
    const { api, http, slept } = apiAnswering(400, json(tooLow));
    await api.quote(body, signal);
    const throttled = apiAnswering(429, json({ message: "m" }));
    await expect(throttled.api.quote(body, signal)).rejects.toMatchObject({
      code: "relay.rate_limited",
    });
    expect([http.requests().length, slept, throttled.http.requests().length]).toStrictEqual([
      1,
      [],
      1,
    ]);
  });

  it("reads the recorded rate limit of requests v2 as a retryable fault", async () => {
    const { api } = apiAnswering(429, json(rateLimited));
    await expect(api.requests(hash, signal)).rejects.toMatchObject({
      code: "relay.rate_limited",
      retryable: true,
    });
  });

  it("tells the owner to set a key once requests v2 is retired", async () => {
    const { api } = apiAnswering(410, json({ message: "gone" }));
    await expect(api.requests(hash, signal)).rejects.toMatchObject({ code: "relay.unauthorized" });
  });

  it.each([
    [200, json({ requestId: hash })],
    [200, "not json"],
    [500, json({ message: "m" })],
  ])("reads an answer outside its schema (HTTP %d) as Relay unavailable", async (status, text) => {
    const { api } = apiAnswering(status, text);
    await expect(api.quote(body, signal)).rejects.toMatchObject({
      code: "relay.unavailable",
      retryable: true,
    });
  });
});

describe("the quote error codes Relay lists", () => {
  it.each([
    ["AMOUNT_TOO_HIGH", "amount_too_high"],
    ["BLOCKED_WALLET_ADDRESS", "no_route"],
    ["AMOUNT_TOO_LOW", "amount_too_low"],
    ["CHAIN_DISABLED", "no_route"],
    ["EXTRA_TXS_NOT_SUPPORTED", "bad_request"],
    ["FORBIDDEN", "unauthorized"],
    ["INSUFFICIENT_FUNDS", "bad_request"],
    ["INSUFFICIENT_LIQUIDITY", "low_liquidity"],
    ["INVALID_ADDRESS", "bad_request"],
    ["INVALID_EXTRA_TXS", "bad_request"],
    ["INVALID_GAS_LIMIT_FOR_DEPOSIT_SPECIFIED_TXS", "bad_request"],
    ["INVALID_INPUT_CURRENCY", "no_route"],
    ["INVALID_OUTPUT_CURRENCY", "no_route"],
    ["INVALID_RECIPIENT", "no_route"],
    ["INVALID_SLIPPAGE_TOLERANCE", "bad_request"],
    ["NO_INTERNAL_SWAP_ROUTES_FOUND", "no_route"],
    ["NO_QUOTES", "no_route"],
    ["NO_SWAP_ROUTES_FOUND", "no_route"],
    ["PRICE_FETCH_FAILED", "unavailable"],
    ["REQUEST_TIMED_OUT", "unavailable"],
    ["ROUTE_TEMPORARILY_RESTRICTED", "rate_limited"],
    ["RPC_HTTP_ERROR", "unavailable"],
    ["SANCTIONED_CURRENCY", "no_route"],
    ["SANCTIONED_WALLET_ADDRESS", "no_route"],
    ["SERVICE_UNAVAILABLE", "unavailable"],
    ["SOLANA_TX_TOO_LARGE", "bad_request"],
    ["SWAP_IMPACT_TOO_HIGH", "no_route"],
    ["UNAUTHORIZED", "unauthorized"],
    ["UNAUTHORIZED_QUOTE", "unauthorized"],
    ["UNSUPPORTED_CHAIN", "no_route"],
    ["UNSUPPORTED_CURRENCY", "no_route"],
    ["UNSUPPORTED_EXECUTION_TYPE", "bad_request"],
    ["UNSUPPORTED_ROUTE", "no_route"],
    ["USER_RECIPIENT_MISMATCH", "bad_request"],
    ["DESTINATION_TX_FAILED", "unavailable"],
    ["ERC20_ROUTER_ADDRESS_NOT_FOUND", "unavailable"],
    ["UNKNOWN_ERROR", "unavailable"],
    ["SWAP_QUOTE_FAILED", "unavailable"],
    ["PERMIT_FAILED", "bad_request"],
  ])("maps %s to %s", (code, kind) => {
    expect(answerKindOf(400, json({ message: "m", errorCode: code }))).toBe(kind);
  });

  it("reads an answer with no code by its status: the key, a rate limit, else unavailable", () => {
    expect(answerKindOf(401, json({ message: "m" }))).toBe("unauthorized");
    expect(answerKindOf(403, "")).toBe("unauthorized");
    expect(answerKindOf(429, "")).toBe("rate_limited");
    expect(answerKindOf(502, "")).toBe("unavailable");
    expect(answerKindOf(400, json({ errorCode: "SOMETHING_NEW" }))).toBe("unavailable");
  });
});
