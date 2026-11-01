import { createScriptedHttp } from "@binference/plugin-sdk/testing";
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import {
  badDepositorAnswer,
  lowLiquidityAnswer,
  noAmountAnswer,
  notEnabledAnswer,
  notFoundAnswer,
  noRoutesAnswer,
  solanaAnswer,
  tooHighAnswer,
  tooLowAnswer,
  unsupportedChainAnswer,
} from "../testing/recorded-answers.js";
import { usdcToBaseAnswer, usdcToUsdgAnswer } from "../testing/recorded-quotes.js";
import {
  type AcrossApi,
  createAcrossApi,
  depositUrlOf,
  type SwapQuery,
  swapUrlOf,
} from "./across-api.js";
import { answerKindOf } from "./answer-fault.js";

const usdc: Address = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const baseUsdc: Address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const query: SwapQuery = {
  originChainId: 56n,
  destinationChainId: 8453n,
  inputToken: usdc,
  outputToken: baseUsdc,
  askedOutput: baseUsdc,
  amount: 20n * 10n ** 18n,
  depositor: "0x1111111111111111111111111111111111111111",
  recipient: "0x2222222222222222222222222222222222222222",
};
const hash = `0x${"ab".repeat(32)}` as const;
const signal = new AbortController().signal;

function apiAnswering(status: number, body: string): AcrossApi {
  const response = { status, headers: {}, body };
  return createAcrossApi(
    createScriptedHttp([
      { method: "GET", url: swapUrlOf(query), response },
      { method: "GET", url: depositUrlOf(hash), response },
    ]),
  );
}

// An error in the shape Across's API writes every one, for the codes no live request gave.
const errorOf = (code: string, param?: string): string =>
  JSON.stringify({
    type: "AcrossApiError",
    code,
    status: 400,
    message: "m",
    ...(param === undefined ? {} : { param }),
  });

describe("the Across API client", () => {
  it("asks for an exact input refunded to the depositor on BNB Smart Chain, unsimulated", () => {
    const url = new URL(swapUrlOf(query));
    expect(url.origin + url.pathname).toBe("https://app.across.to/api/swap/approval");
    expect(Object.fromEntries(url.searchParams)).toStrictEqual({
      tradeType: "exactInput",
      amount: "20000000000000000000",
      inputToken: usdc,
      outputToken: baseUsdc,
      originChainId: "56",
      destinationChainId: "8453",
      depositor: query.depositor,
      recipient: query.recipient,
      refundAddress: query.depositor,
      refundOnOrigin: "true",
      skipOriginTxEstimation: "true",
    });
  });

  it("reads a recorded direct bridge", async () => {
    const swap = await apiAnswering(200, usdcToBaseAnswer).swap(query, signal);
    expect(swap).toMatchObject({
      ok: true,
      value: { inputAmount: query.amount, expectedFillTime: 2 },
    });
  });

  it.each([
    ["AMOUNT_TOO_LOW, under the route's least amount", tooLowAnswer, "amount_too_low"],
    ["AMOUNT_TOO_HIGH, over the route's limit", tooHighAnswer, "amount_too_high"],
    ["LOW_BRIDGE_LIQUIDITY, which no error list names", lowLiquidityAnswer, "low_liquidity"],
  ])("answers the recorded %s with its reason", async (_, body, reason) => {
    await expect(apiAnswering(400, body).swap(query, signal)).resolves.toStrictEqual({
      ok: false,
      error: reason,
    });
  });

  it.each([
    ["ROUTE_NOT_ENABLED", notEnabledAnswer],
    ["no bridge route from BSC, as while Across served none", noRoutesAnswer],
    ["an output token Across does not bridge, such as Solana's USDC", solanaAnswer],
    ["a chain Across does not know", unsupportedChainAnswer],
  ])("answers no_route for the recorded %s", async (_, body) => {
    await expect(apiAnswering(400, body).swap(query, signal)).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it.each([
    ["an invalid depositor", badDepositorAnswer],
    ["a missing amount", noAmountAnswer],
  ])("throws a bad request fault for the recorded %s, not retryable", async (_, body) => {
    await expect(apiAnswering(400, body).swap(query, signal)).rejects.toMatchObject({
      code: "across.bad_request",
      retryable: false,
      details: { status: 400, answer: "INVALID_PARAM" },
    });
  });

  it.each([
    ["AMOUNT_TOO_LOW", "amount_too_low"],
    ["AMOUNT_TOO_HIGH", "amount_too_high"],
    ["LOW_BRIDGE_LIQUIDITY", "low_liquidity"],
    ["ROUTE_NOT_ENABLED", "no_route"],
    ["SWAP_LIQUIDITY_INSUFFICIENT", "low_liquidity"],
    ["SWAP_QUOTE_UNAVAILABLE", "no_route"],
    ["SWAP_TYPE_NOT_GUARANTEED", "no_route"],
    ["INVALID_PARAM", "no_route"],
    ["MISSING_PARAM", "bad_request"],
    ["INVALID_METHOD", "bad_request"],
    ["ABI_ENCODING_ERROR", "bad_request"],
    ["SIMULATION_ERROR", "unavailable"],
    ["UPSTREAM_RPC_ERROR", "unavailable"],
    ["UPSTREAM_HTTP_ERROR", "unavailable"],
    ["UPSTREAM_GATEWAY_TIMEOUT", "unavailable"],
    ["UNEXPECTED_ERROR", "unavailable"],
    ["A_CODE_ACROSS_ADDS_LATER", "unavailable"],
  ])("reads Across's error code %s as %s", (code, kind) => {
    expect(answerKindOf(400, errorOf(code))).toBe(kind);
  });

  it("reads an invalid wallet or amount as a bad request, an invalid token or chain as no route", () => {
    expect(answerKindOf(400, errorOf("INVALID_PARAM", "recipient"))).toBe("bad_request");
    expect(answerKindOf(400, errorOf("INVALID_PARAM", "outputToken"))).toBe("no_route");
    expect(answerKindOf(400, errorOf("INVALID_PARAM", "originChainId"))).toBe("no_route");
  });

  it.each([
    [429, "Too Many Requests", "across.rate_limited"],
    [500, "upstream down", "across.unavailable"],
    [502, errorOf("UPSTREAM_GATEWAY_TIMEOUT"), "across.unavailable"],
  ])("throws a retryable fault for HTTP %i", async (status, body, code) => {
    await expect(apiAnswering(status, body).swap(query, signal)).rejects.toMatchObject({
      code,
      retryable: true,
    });
  });

  it("answers no_route when Across quotes the route only with a swap on either side", async () => {
    await expect(apiAnswering(200, usdcToUsdgAnswer).swap(query, signal)).resolves.toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("throws an unavailable fault for an answer that is no JSON or breaks its schema", async () => {
    await expect(apiAnswering(200, "<html>").swap(query, signal)).rejects.toMatchObject({
      code: "across.unavailable",
    });
    await expect(apiAnswering(200, "{}").swap(query, signal)).rejects.toMatchObject({
      code: "across.unavailable",
    });
  });

  it("reads Across's deposit not found as unseen, and any other 404 as a fault", async () => {
    await expect(apiAnswering(404, notFoundAnswer).deposit(hash, signal)).resolves.toBe("unseen");
    await expect(apiAnswering(404, "Not Found").deposit(hash, signal)).rejects.toMatchObject({
      code: "across.unavailable",
    });
  });

  it("reads a filled status that names no fill as a fault", async () => {
    const body = JSON.stringify({
      status: "filled",
      originChainId: 56,
      destinationChainId: 8453,
      depositTxHash: hash,
      fillTx: null,
    });
    await expect(apiAnswering(200, body).deposit(hash, signal)).rejects.toMatchObject({
      code: "across.unavailable",
    });
  });

  it.each(["pending", "received", "slowFillRequested"])(
    "reads Across's step %s before a fill as pending",
    async (status) => {
      const body = JSON.stringify({
        status,
        originChainId: 56,
        destinationChainId: 8453,
        depositTxHash: hash,
      });
      await expect(apiAnswering(200, body).deposit(hash, signal)).resolves.toMatchObject({
        status: "pending",
      });
    },
  );
});
