import { assetRefSchema, type TxDraft } from "@binference/plugin-sdk";
import {
  curveReaderContract,
  hostBuildRequest,
  quoterContract,
  txBuilderContract,
  txDecoderContract,
} from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { createFlapVenue } from "./flap-venue.js";
import { swapFunctionJson } from "./portal/portal-calls.js";
import {
  bnb,
  bscChain,
  graduatedToken,
  portalContracts,
  recordedWallet,
  requestOf,
  scriptedPortal,
  taxToken,
  usd1,
  usdt,
  usdtToken,
  venueOver,
} from "./testing/portal-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const buyRequest = requestOf({ asset: bnb, base: parseEther("0.1") }, taxToken);
const quoted = await venueOver(scriptedPortal()).quote(buyRequest, { signal: live() });
if (!quoted.ok) {
  throw new Error("The recorded answers gave no quote.");
}
const buildRequest = hostBuildRequest(buyRequest, quoted.value, { deadlineMs: 1_800_000_060_000 });
const [trade] = await venueOver(scriptedPortal()).build(buildRequest, { signal: live() });
const usdtBuy = requestOf({ asset: usdt, base: parseEther("10") }, usdtToken);
const usdtQuoted = await venueOver(scriptedPortal()).quote(usdtBuy, { signal: live() });
if (!usdtQuoted.ok) {
  throw new Error("The recorded answers gave no USDT quote.");
}
const [approval] = await venueOver(scriptedPortal()).build(
  hostBuildRequest(usdtBuy, usdtQuoted.value, { deadlineMs: 1_800_000_060_000 }),
  { signal: live() },
);

function draftOf(draft: TxDraft | undefined): TxDraft {
  if (draft === undefined) {
    throw new Error("The build gave no draft.");
  }
  return draft;
}

describe("the flap venue", () => {
  it.each([
    ...quoterContract({
      create: () => ({
        quoter: venueOver(scriptedPortal()),
        request: buyRequest,
        unroutable: { ...buyRequest, assetOut: graduatedToken },
      }),
    }),
    ...txBuilderContract({
      create: () => ({ builder: venueOver(scriptedPortal()), request: buildRequest }),
    }),
    ...txDecoderContract({
      create: () => ({
        decoder: venueOver(scriptedPortal()),
        draft: draftOf(trade),
        effect: {
          recipient: recordedWallet,
          amountIn: buildRequest.amountIn,
          minOut: buildRequest.minOut,
        },
        foreign: draftOf(approval),
      }),
    }),
    ...curveReaderContract({
      create: () => ({
        reader: venueOver(scriptedPortal()),
        onCurve: { token: taxToken, contracts: portalContracts },
        offCurve: { token: graduatedToken, contracts: portalContracts },
      }),
    }),
  ])("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("declares the Portal's swap as its one call, the Portal as spender, and no deadline", () => {
    expect(venueOver(scriptedPortal()).contracts).toStrictEqual([
      {
        chain: bscChain,
        names: ["portal"],
        calls: [{ contract: "portal", abi: swapFunctionJson, walletInputs: [] }],
        spenders: ["portal"],
        noDeadline: true,
      },
    ]);
  });

  it.each([
    ["no chain", []],
    ["a chain twice", [bscChain, bscChain]],
  ])("refuses options with %s", (_case, chains) => {
    const rpc = scriptedPortal();
    expect(() =>
      createFlapVenue({
        chains: chains.map((chain) => ({ chain, nativeAsset: bnb, quoteTokens: [usdt], rpc })),
      }),
    ).toThrow(expect.objectContaining({ code: "flap.bad_options" }));
  });

  it.each([
    ["a native asset that is a token", { nativeAsset: usdt }],
    ["a quote token that is the coin", { quoteTokens: [bnb] }],
    [
      "a quote token of another chain",
      {
        quoteTokens: [
          assetRefSchema.parse("eip155:1/erc20:0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d"),
        ],
      },
    ],
    ["a quote token twice", { quoteTokens: [usd1, usd1] }],
  ])("refuses a chain with %s", (_case, change) => {
    const chain = { chain: bscChain, nativeAsset: bnb, quoteTokens: [usdt], rpc: scriptedPortal() };
    expect(() => createFlapVenue({ chains: [{ ...chain, ...change }] })).toThrow(
      expect.objectContaining({ code: "flap.bad_options" }),
    );
  });
});
