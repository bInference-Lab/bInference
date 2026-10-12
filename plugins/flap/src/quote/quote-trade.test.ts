import { assetRefSchema } from "@binference/plugin-sdk";
import { parseEther, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { createFlapVenue } from "../flap-venue.js";
import { quoteCallData, stateCallData } from "../portal/portal-calls.js";
import {
  bnb,
  bscChain,
  graduatedToken,
  type PortalAnswer,
  recordedAnswers,
  requestOf,
  scriptedPortal,
  taxToken,
  usd1,
  usdt,
  usdtToken,
  venueOver,
} from "../testing/portal-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const tenthBnb = { asset: bnb, base: parseEther("0.1") };
const taxTokenAddress = "0x7270576A906EAe19a995273695ec223056bD7777";
const usdtAddress = "0x55d398326f99059fF775485246999027B3197955";

function answersWith(data: string, answer: PortalAnswer): ReadonlyMap<string, PortalAnswer> {
  return new Map([...recordedAnswers, [data, answer]]);
}

describe("flap quotes", () => {
  it("quotes a buy on a BNB curve with the tax the Portal takes on a buy", async () => {
    const rpc = scriptedPortal();
    const quote = await venueOver(rpc).quote(requestOf(tenthBnb, taxToken), { signal: live() });
    expect(quote).toStrictEqual({
      ok: true,
      value: {
        expectedOut: { asset: taxToken, base: 8_713_660_171_676_404_705_620_203n },
        priceImpactBps: 206,
        taxBps: 300,
      },
    });
    expect(rpc.asked).toHaveLength(2);
  });

  it("quotes a sale on a BNB curve with the tax the Portal takes on a sale", async () => {
    const request = requestOf({ asset: taxToken, base: parseEther("1000000") }, bnb);
    expect(await venueOver(scriptedPortal()).quote(request, { signal: live() })).toStrictEqual({
      ok: true,
      value: {
        expectedOut: { asset: bnb, base: 10_446_588_764_443_689n },
        priceImpactBps: 116,
        taxBps: 300,
      },
    });
  });

  it("quotes a buy and a sale on a USDT curve against USDT", async () => {
    const venue = venueOver(scriptedPortal());
    const buy = requestOf({ asset: usdt, base: parseEther("10") }, usdtToken);
    const sale = requestOf({ asset: usdtToken, base: parseEther("100000") }, usdt);
    expect(await venue.quote(buy, { signal: live() })).toMatchObject({
      ok: true,
      value: { expectedOut: { base: 1_464_256_780_752_538_830_740_403n }, taxBps: 100 },
    });
    expect(await venue.quote(sale, { signal: live() })).toMatchObject({
      ok: true,
      value: { expectedOut: { asset: usdt, base: 647_929_678_604_183_249n }, taxBps: 200 },
    });
  });

  it("answers a token that graduated as no route, and never asks the Portal's quote", async () => {
    const rpc = scriptedPortal();
    const quote = await venueOver(rpc).quote(requestOf(tenthBnb, graduatedToken), {
      signal: live(),
    });
    expect(quote).toStrictEqual({ ok: false, error: "no_route" });
    expect(rpc.asked).toHaveLength(1);
  });

  it("answers a buy that would sell the rest of the curve as no route", async () => {
    const request = requestOf({ asset: bnb, base: parseEther("100") }, taxToken);
    expect(await venueOver(scriptedPortal()).quote(request, { signal: live() })).toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it.each([
    ["a USDT curve token with BNB", requestOf(tenthBnb, usdtToken)],
    ["a BNB curve token with USD1", requestOf({ asset: usd1, base: parseEther("10") }, taxToken)],
    ["one quote token with another", requestOf({ asset: usdt, base: parseEther("10") }, usd1)],
    ["BNB for itself", requestOf(tenthBnb, bnb)],
    [
      "an asset of another chain",
      requestOf(
        tenthBnb,
        assetRefSchema.parse("eip155:1/erc20:0x7270576A906EAe19a995273695ec223056bD7777"),
      ),
    ],
  ])("answers a buy of %s as no route", async (_case, request) => {
    expect(await venueOver(scriptedPortal()).quote(request, { signal: live() })).toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("answers a token Flap never launched as no route, from the Portal's own answer", async () => {
    const rpc = scriptedPortal();
    const venue = createFlapVenue({
      chains: [{ chain: bscChain, nativeAsset: bnb, quoteTokens: [usd1], rpc }],
    });
    expect(await venue.quote(requestOf(tenthBnb, usdt), { signal: live() })).toStrictEqual({
      ok: false,
      error: "no_route",
    });
    expect(rpc.asked).toStrictEqual([stateCallData(usdtAddress)]);
  });

  it("answers a quote the Portal reverts as no route", async () => {
    const quoteData = quoteCallData({
      inputToken: zeroAddress,
      outputToken: taxTokenAddress,
      inputAmount: tenthBnb.base,
    });
    const rpc = scriptedPortal(answersWith(quoteData, { revert: "0x" }));
    expect(
      await venueOver(rpc).quote(requestOf(tenthBnb, taxToken), { signal: live() }),
    ).toStrictEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("throws when the Portal reverts the state read for another reason", async () => {
    const rpc = scriptedPortal(answersWith(stateCallData(taxTokenAddress), { revert: "0x" }));
    await expect(
      venueOver(rpc).quote(requestOf(tenthBnb, taxToken), { signal: live() }),
    ).rejects.toMatchObject({ code: "flap.read_failed" });
  });

  it("throws when the state read answers outside its shape", async () => {
    const rpc = scriptedPortal(answersWith(stateCallData(taxTokenAddress), { result: "0x01" }));
    await expect(
      venueOver(rpc).quote(requestOf(tenthBnb, taxToken), { signal: live() }),
    ).rejects.toMatchObject({ code: "flap.read_failed" });
  });

  it("throws without the Portal among the request's contracts", async () => {
    const request = { ...requestOf(tenthBnb, taxToken), contracts: {} };
    await expect(
      venueOver(scriptedPortal()).quote(request, { signal: live() }),
    ).rejects.toMatchObject({ code: "flap.no_contract" });
  });
});
