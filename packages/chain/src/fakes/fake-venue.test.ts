import type { Bps } from "@binference/core";
import { describe, expect, it } from "vitest";
import type { Amount } from "../amount.js";
import { accountRefSchema } from "../caip/account-ref.js";
import { assetRefSchema } from "../caip/asset-ref.js";
import { quoterContract } from "../contracts/quoter-contract.js";
import { txBuilderContract } from "../contracts/tx-builder-contract.js";
import { txDecoderContract } from "../contracts/tx-decoder-contract.js";
import type { BuildRequest } from "../venues/build-request.js";
import type { DecodedEffect } from "../venues/decoded-effect.js";
import type { QuoteRequest } from "../venues/venue-quote.js";
import { fakeApprovalData, fakeDraft } from "./fake-draft.js";
import { createFakeFamily } from "./fake-family.js";
import { createFakeVenue, fakeSwapData } from "./fake-venue.js";

const wallet = accountRefSchema.parse("fake:1:0x0000000c");
const router = accountRefSchema.parse("fake:1:0x0000000b");
const coin = assetRefSchema.parse("fake:1/slip44:1");
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const signal = new AbortController().signal;

function quoteRequest(amountIn: Amount): QuoteRequest {
  const assetOut = amountIn.asset === coin ? token : coin;
  return { wallet, amountIn, assetOut, contracts: { router } };
}

function buildRequest(amountIn: Amount): BuildRequest {
  const request = quoteRequest(amountIn);
  const expectedOut = { asset: request.assetOut, base: amountIn.base * 2n };
  return {
    ...request,
    quote: { expectedOut, priceImpactBps: 10 as Bps },
    minOut: { asset: request.assetOut, base: amountIn.base },
    deadlineMs: 1_800_000_060_000,
  };
}

function effectOf(request: BuildRequest): DecodedEffect {
  const { amountIn, minOut, deadlineMs } = request;
  return { recipient: request.wallet, amountIn, minOut, deadlineMs };
}

const spendCoin = buildRequest({ asset: coin, base: 1_000n });
const spendToken = buildRequest({ asset: token, base: 500n });
const coinSwap = fakeDraft(wallet, {
  to: "0x0000000b",
  value: 1_000n,
  data: fakeSwapData(effectOf(spendCoin)),
});
const approval = fakeDraft(wallet, {
  to: "0x0000000a",
  value: 0n,
  data: fakeApprovalData("0x0000000b", 500n),
});

describe("fake venue", () => {
  it.each(
    quoterContract({
      create: () => ({
        quoter: createFakeVenue(),
        request: quoteRequest(spendCoin.amountIn),
        unroutable: { ...quoteRequest(spendCoin.amountIn), assetOut: coin },
      }),
    }),
  )("follows the quoter contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    txBuilderContract({ create: () => ({ builder: createFakeVenue(), request: spendToken }) }),
  )("follows the builder contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it.each(
    txDecoderContract({
      create: () => ({
        decoder: createFakeVenue(),
        draft: coinSwap,
        effect: effectOf(spendCoin),
        foreign: approval,
      }),
    }),
  )("follows the decoder contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("quotes at its rate, rounding down", async () => {
    const venue = createFakeVenue({ rate: { numerator: 3n, denominator: 2n } });
    const quote = await venue.quote(quoteRequest({ asset: coin, base: 5n }), { signal });
    expect(quote).toStrictEqual({
      ok: true,
      value: { expectedOut: { asset: token, base: 7n }, priceImpactBps: 10 },
    });
  });

  it("sends the coin with its trade call when the input is the chain's coin", async () => {
    await expect(createFakeVenue().build(spendCoin, { signal })).resolves.toStrictEqual([coinSwap]);
  });

  it("builds an exact approval to its router before the trade call for a token input", async () => {
    const drafts = await createFakeVenue().build(spendToken, { signal });
    const family = createFakeFamily();
    expect(drafts).toHaveLength(2);
    expect(drafts[0]).toStrictEqual(approval);
    expect(drafts.map((draft) => family.readDraft(draft))).toStrictEqual([
      {
        ok: true,
        value: {
          target: accountRefSchema.parse("fake:1:0x0000000a"),
          nativeValue: 0n,
          approval: { asset: token, spender: router, amountBase: 500n },
        },
      },
      { ok: true, value: { target: router, nativeValue: 0n } },
    ]);
  });

  it("decodes the trade call it builds into the terms it was asked for", async () => {
    const venue = createFakeVenue();
    const drafts = await venue.build(spendToken, { signal });
    expect(drafts.map((draft) => venue.decode(draft))).toStrictEqual([
      { ok: false, error: "unknown_call" },
      { ok: true, value: effectOf(spendToken) },
    ]);
  });

  it.each([
    ["a word short", "swap,0x0000000c,5,fake:1/slip44:1,5,fake:1/token:0x0000000a"],
    ["a deadline that is no number", `${fakeSwapData(effectOf(spendCoin)).slice(0, -1)}x`],
    ["an input that is no asset", "swap,0x0000000c,5,coin,5,fake:1/token:0x0000000a,1"],
    ["an output that is no asset", "swap,0x0000000c,5,fake:1/slip44:1,5,coin,1"],
    ["an amount that is no amount", "swap,0x0000000c,-5,fake:1/slip44:1,5,fake:1/slip44:1,1"],
    ["a recipient that is no address", "swap,a b,5,fake:1/slip44:1,5,fake:1/slip44:1,1"],
  ])("answers a trade call with %s as an unknown call", (_case, data) => {
    const draft = fakeDraft(wallet, { to: "0x0000000b", value: 0n, data });
    expect(createFakeVenue().decode(draft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });

  it("answers a draft that is no fake call as an unknown call", () => {
    expect(createFakeVenue().decode({ ...coinSwap, payload: "x" })).toStrictEqual({
      ok: false,
      error: "unknown_call",
    });
  });

  it("refuses to build without its router", async () => {
    await expect(
      createFakeVenue().build({ ...spendCoin, contracts: {} }, { signal }),
    ).rejects.toMatchObject({ code: "venue.no_contract" });
  });
});
