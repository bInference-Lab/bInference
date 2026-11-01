import {
  BinferenceError,
  accountRefSchema,
  type BridgeQuote,
  type BridgeQuoteRequest,
} from "@binference/plugin-sdk";
import { createScriptedHttp, successOf } from "@binference/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import { createAcrossBridge } from "../across-bridge.js";
import { createAcrossApi, type SwapQuery, swapUrlOf } from "../api/across-api.js";
import { editedAnswer } from "../testing/answer-edits.js";
import {
  bsc,
  recordedOptions,
  recordedRoutes,
  requestFor,
  tokens,
} from "../testing/bridge-fixtures.js";
import { tooHighAnswer } from "../testing/recorded-answers.js";
import { usdcToBaseAnswer, wethToBaseAnswer } from "../testing/recorded-quotes.js";
import { readDepositRecord } from "./deposit-record.schema.js";
import { quoteBridge } from "./quote-bridge.js";
import { routeQueryOf } from "./route-query.js";

const live = { signal: new AbortController().signal };
const request = requestFor(tokens.usdc, tokens.baseUsdc);
const options = { http: createScriptedHttp([]), chains: [bsc], routes: recordedRoutes };

// The Swap API query the bridge makes for a request it takes.
function queryOf(asked: BridgeQuoteRequest): SwapQuery {
  const query = routeQueryOf(asked, options)?.query;
  if (query === undefined) {
    throw new BinferenceError({ code: "across.bad_fixture", message: "Not a request it takes." });
  }
  return query;
}

// The bridge's quote of a request when Across's API gives this answer to its query.
async function quoteWith(body: string, status = 200, asked = request) {
  const response = { status, headers: {}, body };
  const url = swapUrlOf(queryOf(asked));
  const api = createAcrossApi(createScriptedHttp([{ method: "GET", url, response }]));
  return await quoteBridge(asked, { api, options }, live.signal);
}

// The recorded USDC answer to Base with some of its fields changed.
function answerWith(fields: Readonly<Record<string, unknown>>): string {
  const parsed: unknown = JSON.parse(usdcToBaseAnswer);
  return JSON.stringify({ ...(parsed as object), ...fields });
}

const swapTxTo = (to: string) => {
  const parsed = JSON.parse(usdcToBaseAnswer) as { swapTx: object };
  return { swapTx: { ...parsed.swapTx, to } };
};

describe("an Across quote", () => {
  it("answers amount_too_high for an amount over Across's limit for the route", async () => {
    await expect(quoteWith(tooHighAnswer, 400)).resolves.toStrictEqual({
      ok: false,
      error: "amount_too_high",
    });
  });

  it("keeps Across's deposit terms in its record for the build", async () => {
    const quote: BridgeQuote = successOf(await quoteWith(usdcToBaseAnswer));
    expect(readDepositRecord(quote.route)).toStrictEqual({
      depositor: "0x1111111111111111111111111111111111111111",
      recipient: "0x2222222222222222222222222222222222222222",
      inputToken: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      outputToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      inputAmount: 20n * 10n ** 18n,
      destinationChainId: 8453n,
      outputAmount: 19_972_096n,
      exclusiveRelayer: "0x394311A6Aaa0D8E3411D8b62DE4578D41322d1bD",
      quoteTimestamp: 1_793_528_627,
      fillDeadline: 1_793_535_827,
      exclusivityParameter: 20,
    });
  });

  it.each([
    ["through another contract", swapTxTo("0x97CCDBea4632140639aD5eA9b944aa034eb15fD4")],
    ["of another amount", { inputAmount: "1" }],
    ["paying more than Across expects", { expectedOutputAmount: "1" }],
    ["expiring before it was given", { quoteExpiryTimestamp: 1_793_528_627 }],
  ])("refuses an answer %s as a bad quote", async (_, fields) => {
    await expect(quoteWith(answerWith(fields))).rejects.toMatchObject({ code: "across.bad_quote" });
  });

  it("refuses a deposit Across encoded to another recipient as a bad quote", async () => {
    const other = accountRefSchema.parse("eip155:8453:0x3333333333333333333333333333333333333333");
    const asked = { ...request, recipient: other };
    await expect(quoteWith(usdcToBaseAnswer, 200, asked)).rejects.toMatchObject({
      code: "across.bad_quote",
    });
  });

  it("asks for the coin on a wrapped route, and refuses Across's handler deposit with a message", async () => {
    const eth = requestFor(tokens.eth, tokens.baseWeth);
    expect(queryOf(eth).askedOutput).toBe("0x0000000000000000000000000000000000000000");
    await expect(quoteWith(wethToBaseAnswer, 200, eth)).rejects.toMatchObject({
      code: "across.bad_quote",
    });
  });

  it("refuses to build a quote without its record, below the host's least output, or uncapped", async () => {
    const bridge = createAcrossBridge(recordedOptions());
    const quote = successOf(await bridge.quote(request, live));
    const { minOut } = quote;
    const withoutRecord = { ...quote, route: "{}" };
    await expect(
      bridge.build({ ...request, quote: withoutRecord, minOut }, live),
    ).rejects.toMatchObject({ code: "across.bad_quote" });
    const higher = { ...minOut, base: minOut.base + 1n };
    await expect(bridge.build({ ...request, quote, minOut: higher }, live)).rejects.toMatchObject({
      code: "across.below_min",
    });
    const uncapped = { ...request, cappedAssets: [], quote, minOut };
    await expect(bridge.build(uncapped, live)).rejects.toMatchObject({ code: "across.no_route" });
  });

  it("refuses to build a 20 USDC quote as a 2,000 USDC deposit", async () => {
    const bridge = createAcrossBridge(recordedOptions());
    const quote = successOf(await bridge.quote(request, live));
    const larger = { ...request.amountIn, base: 2_000n * 10n ** 18n };
    const build = { ...request, amountIn: larger, quote, minOut: quote.minOut };
    await expect(bridge.build(build, live)).rejects.toMatchObject({
      code: "across.quote_mismatch",
    });
  });

  // The recorded quote's own figures: 20 USDC in, 27.904e15 in fees, output 19.972096 USDC.
  const quotedAt = 1_793_528_627;

  it.each([
    ["an output of one base unit beside fees that leave 19.97 USDC", { output: 1n }],
    ["a least output below the expected one", { minOutput: 19_972_095n }],
    ["fees that do not leave its output", { relayerFee: 24_006_000_000_000_001n }],
    ["an exclusivity of the whole uint32", { exclusivity: 0xffff_ffff }],
    ["an exclusivity over 10 minutes", { exclusivity: 601 }],
    ["a fill deadline of the whole uint32", { fillDeadline: 0xffff_ffff }],
    ["a fill deadline more than 6 hours after the quote", { fillDeadline: quotedAt + 21_601 }],
    ["a fill deadline before the quote expires", { fillDeadline: quotedAt + 3_600 }],
    ["a quote that holds more than an hour", { expiry: quotedAt + 3_601 }],
  ])("refuses an answer with %s as a bad quote", async (_, edit) => {
    await expect(quoteWith(editedAnswer(edit))).rejects.toMatchObject({ code: "across.bad_quote" });
  });

  it("takes the recorded answer as edited with nothing changed", async () => {
    await expect(quoteWith(editedAnswer({}))).resolves.toMatchObject({ ok: true });
  });

  it("names the coin a fill pays a wallet on a wrapped route, and none on a dollar route", async () => {
    const bridge = createAcrossBridge(recordedOptions());
    const eth = successOf(await bridge.quote(requestFor(tokens.eth, tokens.baseWeth), live));
    expect(eth.deliveredAsCoin).toBe("eip155:8453/slip44:60");
    expect(successOf(await bridge.quote(request, live)).deliveredAsCoin).toBeUndefined();
  });

  it("refuses a decimals answer that differs from the registry's as a bad quote", async () => {
    const answer: unknown = JSON.parse(usdcToBaseAnswer);
    const parsed = answer as { outputToken: object };
    const body = JSON.stringify({
      ...(answer as object),
      outputToken: { ...parsed.outputToken, decimals: 18 },
    });
    await expect(quoteWith(body)).rejects.toMatchObject({ code: "across.bad_quote" });
  });
});
