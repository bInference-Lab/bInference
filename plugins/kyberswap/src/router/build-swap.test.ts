import { accountRefSchema, type BuildRequest, type TxDraft } from "@binference/plugin-sdk";
import { decodeEvmDraft } from "@binference/plugin-sdk/evm";
import * as fc from "fast-check";
import { encodeFunctionData, erc20Abi } from "viem";
import { describe, expect, it } from "vitest";
import { buyBuild, buyRoute } from "../testing/recorded-buy.js";
import { sellBuild, sellRoute } from "../testing/recorded-sell.js";
import { recordedDeadlineSec, recordedWallet } from "../testing/recorded-terms.js";
import {
  answer,
  bnb,
  buildRequestOf,
  draftAt,
  buildUrl,
  buyRequest,
  buyRoutesUrl,
  scriptedApi,
  sellRequest,
  sellRoutesUrl,
  usdt,
  valueOf,
  venueOver,
} from "../testing/venue-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const router = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const executor = "8f10b468b06c6fd214b65f87778827f7d113f996";
// What KyberSwap's API encoded with a 0.5% slippage on its build's output.
const apiMinimum = 76_321_695_368_036_993_739n;

const recorded = scriptedApi({
  [buyRoutesUrl]: answer(buyRoute),
  [sellRoutesUrl]: answer(sellRoute),
});
const buyQuote = valueOf(await venueOver(recorded).quote(buyRequest, { signal: live() }));
const sellQuote = valueOf(await venueOver(recorded).quote(sellRequest, { signal: live() }));
const decoder = venueOver(scriptedApi({}));

async function build(request: BuildRequest, buildAnswer = buyBuild) {
  const http = scriptedApi({ [buildUrl]: answer(buildAnswer) });
  const drafts = await venueOver(http).build(request, { signal: live() });
  return { drafts, http };
}

function callOf(draft: TxDraft) {
  const call = decodeEvmDraft(draft);
  if (!call.ok) {
    throw new Error("The draft is no EVM call.");
  }
  return call.value;
}

// The one request the venue sent, and its JSON body.
function sentTo(http: { requests(): readonly { readonly body?: string }[] }) {
  const [sent] = http.requests();
  if (sent?.body === undefined) {
    throw new Error("The venue sent no body.");
  }
  return { sent, body: JSON.parse(sent.body) as Record<string, unknown> };
}

describe("builds on kyberswap", () => {
  it("builds a coin buy as one router call with the host's terms", async () => {
    const request = buildRequestOf(buyRequest, buyQuote);
    const { drafts } = await build(request);
    expect(drafts).toHaveLength(1);
    expect(callOf(draftAt(drafts, 0))).toMatchObject({ to: router, value: 10n ** 17n });
    expect(decoder.decode(draftAt(drafts, 0))).toStrictEqual({
      ok: true,
      value: {
        recipient: recordedWallet,
        amountIn: { asset: bnb, base: 10n ** 17n },
        minOut: request.minOut,
        deadlineMs: recordedDeadlineSec * 1000,
      },
    });
  });

  it("asks KyberSwap to encode the quoted route for the wallet, by the host's deadline", async () => {
    const request = { ...buildRequestOf(buyRequest, buyQuote), deadlineMs: 1_791_378_457_999 };
    const { sent, body } = sentTo((await build(request)).http);
    expect(sent).toMatchObject({
      method: "POST",
      headers: { "x-client-id": "binference", "content-type": "application/json" },
    });
    expect(body).toStrictEqual({
      routeSummary: JSON.parse(String(buyQuote.route)) as unknown,
      sender: "0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",
      recipient: "0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",
      deadline: recordedDeadlineSec,
      slippageTolerance: 50,
      source: "binference",
    });
  });

  it.each([
    ["the host's minimum, raised from the API's", 10_000n, 76_705_221_475_414_064_061n],
    ["the API's minimum when it is above the host's", 9_000n, apiMinimum],
  ])("builds a call that keeps %s", async (_case, keepBps, minimum) => {
    const request = buildRequestOf(buyRequest, buyQuote, keepBps);
    const { drafts } = await build(request);
    expect(valueOf(decoder.decode(draftAt(drafts, 0))).minOut.base).toBe(minimum);
  });

  it("never builds a call whose minimum is below the host's", async () => {
    const expected = buyQuote.expectedOut.base;
    await fc.assert(
      fc.asyncProperty(fc.bigInt({ min: 1n, max: expected * 2n }), async (minimum) => {
        const request = {
          ...buildRequestOf(buyRequest, buyQuote),
          minOut: { asset: usdt, base: minimum },
        };
        const { drafts } = await build(request);
        const decoded = valueOf(decoder.decode(draftAt(drafts, 0))).minOut.base;
        expect([decoded >= minimum, decoded >= apiMinimum]).toStrictEqual([true, true]);
        expect([minimum, apiMinimum]).toContain(decoded);
      }),
      { numRuns: 50 },
    );
  });

  it("asks for at most KyberSwap's largest slippage", async () => {
    const { http } = await build(buildRequestOf(buyRequest, buyQuote, 5_000n));
    expect(sentTo(http).body).toMatchObject({ slippageTolerance: 2_000 });
  });

  it("builds a token sale as an exact approval of the router, then the router call", async () => {
    const request = buildRequestOf(sellRequest, sellQuote);
    const { drafts } = await build(request, sellBuild);
    expect(drafts).toHaveLength(2);
    expect(callOf(draftAt(drafts, 0))).toStrictEqual({
      from: "0x8B357176C76fbbfdF51E196C9Bf6843642Aca70e",
      to: "0x55d398326f99059fF775485246999027B3197955",
      value: 0n,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [router, 50n * 10n ** 18n],
      }),
    });
    expect(callOf(draftAt(drafts, 1))).toMatchObject({ to: router, value: 0n });
    expect(valueOf(decoder.decode(draftAt(drafts, 1)))).toMatchObject({
      amountIn: { asset: usdt, base: 50n * 10n ** 18n },
      minOut: { asset: bnb },
    });
  });

  it.each([
    [
      "another router",
      buyBuild.replace(
        `"routerAddress": "${router}"`,
        '"routerAddress": "0x6868D319c8c9A78F7d39DC3602C5c917315132D7"',
      ),
    ],
    ["another executor", buyBuild.replace(executor, "6868d319c8c9a78f7d39dc3602c5c917315132d7")],
    [
      "calldata that is no router call",
      buyBuild.replace('"data": "0xe21fd0e9', '"data": "0xe21fd0ea'),
    ],
  ])("refuses an encoded call through %s", async (_case, buildAnswer) => {
    const request = buildRequestOf(buyRequest, buyQuote);
    await expect(build(request, buildAnswer)).rejects.toMatchObject({
      code: "kyberswap.bad_build",
    });
  });

  it("refuses a quote that carries no route of its own", async () => {
    const { route: _route, ...quote } = buyQuote;
    const request = buildRequestOf(buyRequest, quote);
    await expect(build(request)).rejects.toMatchObject({ code: "kyberswap.no_route" });
  });

  it("refuses a wallet on a chain it does not trade on", async () => {
    const wallet = accountRefSchema.parse(recordedWallet.replace("eip155:56:", "eip155:1:"));
    const request = { ...buildRequestOf(buyRequest, buyQuote), wallet };
    await expect(build(request)).rejects.toMatchObject({ code: "kyberswap.no_chain" });
  });

  it("throws when KyberSwap cannot encode the route", async () => {
    const request = buildRequestOf(buyRequest, buyQuote);
    const http = scriptedApi({
      [buildUrl]: answer('{"code":4008,"message":"route not found"}', 400),
    });
    await expect(venueOver(http).build(request, { signal: live() })).rejects.toMatchObject({
      code: "kyberswap.unavailable",
      retryable: false,
    });
  });
});
