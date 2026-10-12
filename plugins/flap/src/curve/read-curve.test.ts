import { assetRefSchema, type CurveRequest } from "@binference/plugin-sdk";
import { describe, expect, it } from "vitest";
import { stateCallData } from "../portal/portal-calls.js";
import {
  bnb,
  graduatedToken,
  portalContracts,
  recordedAnswers,
  scriptedPortal,
  taxToken,
  usdt,
  usdtToken,
  venueOver,
} from "../testing/portal-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const ask = (token: CurveRequest["token"]): CurveRequest => ({ token, contracts: portalContracts });

describe("the flap curve read", () => {
  it.each([
    ["a BNB curve token, against BNB", taxToken, bnb],
    ["a USDT curve token, against USDT", usdtToken, usdt],
  ])("holds %s", async (_case, token, quoteAsset) => {
    expect(await venueOver(scriptedPortal()).curve(ask(token), { signal: live() })).toStrictEqual({
      onCurve: true,
      quoteAsset,
    });
  });

  it.each([
    ["a token that graduated to a pool", graduatedToken],
    ["a token Flap never launched", usdt],
  ])("answers %s as off its curve", async (_case, token) => {
    expect(await venueOver(scriptedPortal()).curve(ask(token), { signal: live() })).toStrictEqual({
      onCurve: false,
    });
  });

  it.each([
    ["the chain's coin", bnb],
    [
      "a token of another chain",
      assetRefSchema.parse("eip155:1/erc20:0x7270576A906EAe19a995273695ec223056bD7777"),
    ],
  ])("answers %s as off its curve without reading the Portal", async (_case, token) => {
    const rpc = scriptedPortal();
    expect(await venueOver(rpc).curve(ask(token), { signal: live() })).toStrictEqual({
      onCurve: false,
    });
    expect(rpc.asked).toHaveLength(0);
  });

  it("throws when the Portal reverts the read for another reason than an unknown token", async () => {
    const data = stateCallData("0x7270576A906EAe19a995273695ec223056bD7777");
    const rpc = scriptedPortal(new Map([...recordedAnswers, [data, { revert: "0x08c379a0" }]]));
    await expect(venueOver(rpc).curve(ask(taxToken), { signal: live() })).rejects.toMatchObject({
      code: "flap.read_failed",
    });
  });
});
