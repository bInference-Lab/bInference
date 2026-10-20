import {
  assetRefSchema,
  type LaunchpadVenue,
  type LaunchReader,
  type PriceRead,
  type PriceReader,
  type Result,
  type TxDraft,
} from "@binference/plugin-sdk";
import {
  curveReaderContract,
  hostBuildRequest,
  launchReaderContract,
  priceReaderContract,
  quoterContract,
  txBuilderContract,
  txDecoderContract,
} from "@binference/plugin-sdk/testing";
import { parseEther } from "viem";
import { describe, expect, it } from "vitest";
import { createFlapVenue, flapDeclaration } from "./flap-venue.js";
import { newTokenFunctionJson } from "./portal/launch-call.js";
import { stateCallData, swapFunctionJson } from "./portal/portal-calls.js";
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
import { flapBuyLogs, flapLaunchLogs, recordedLaunch } from "./testing/recorded-launches.js";
import { graduatedState, taxTokenState, usdtTokenState } from "./testing/recorded-portal.js";

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

function priceReaderOf(venue: LaunchpadVenue): PriceReader {
  const read = venue.priceRead?.bind(venue);
  if (read === undefined) {
    throw new Error("The venue declares no price read.");
  }
  return { priceRead: read };
}

function launchReaderOf(venue: LaunchpadVenue): LaunchReader {
  const { launchEvents, readLaunches } = venue;
  if (launchEvents === undefined || readLaunches === undefined) {
    throw new Error("The venue reads no launch.");
  }
  return { launchEvents, readLaunches };
}

function readValue(result: Result<PriceRead, "no_price_read">): PriceRead {
  if (!result.ok) {
    throw new Error("The venue gave no price read.");
  }
  return result.value;
}

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
    ...priceReaderContract({
      create: () => ({
        reader: priceReaderOf(venueOver(scriptedPortal())),
        priced: { token: taxToken, contracts: portalContracts },
        answers: [taxTokenState],
        unpriced: { token: graduatedToken, contracts: portalContracts },
      }),
    }),
    ...launchReaderContract({
      create: () => ({
        reader: launchReaderOf(venueOver(scriptedPortal())),
        chain: bscChain,
        contracts: portalContracts,
        launch: { logs: flapLaunchLogs, token: recordedLaunch.token },
        other: flapBuyLogs,
        stranger: recordedWallet,
      }),
    }),
  ])("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("prices a curve token by the Portal's own curve price, one read a block", async () => {
    const reader = priceReaderOf(venueOver(scriptedPortal()));
    const read = await reader.priceRead(
      { token: taxToken, contracts: portalContracts },
      { signal: live() },
    );
    expect(read).toMatchObject({
      ok: true,
      value: {
        quoteAsset: bnb,
        calls: [
          { target: portalContracts["portal"], input: stateCallData(taxToken.slice(-42) as never) },
        ],
      },
    });
    const { price } = readValue(read);
    // 10,895,640,606 wei of BNB for one whole token, as the Portal's state says.
    expect(price([taxTokenState])).toStrictEqual({
      ok: true,
      value: { numerator: 10_895_640_606n, denominator: 10n ** 18n },
    });
    const unpriced = { ok: false, error: "unpriced" };
    // A token that left its curve, or trades against another asset, needs another read.
    const replan = { ok: false, error: "replan" };
    expect(price([graduatedState])).toStrictEqual(replan);
    expect(price([usdtTokenState])).toStrictEqual(replan);
    expect(price(["0x1234"])).toStrictEqual(unpriced);
    expect(price([taxTokenState, taxTokenState])).toStrictEqual(unpriced);
  });

  it("prices a token on a USDT curve in USDT, and nothing Flap does not hold", async () => {
    const reader = priceReaderOf(venueOver(scriptedPortal()));
    const signal = live();
    const read = await reader.priceRead(
      { token: usdtToken, contracts: portalContracts },
      { signal },
    );
    expect(readValue(read).quoteAsset).toBe(usdt);
    const refusals = await Promise.all(
      [
        usdt,
        bnb,
        assetRefSchema.parse("eip155:1/erc20:0x55d398326f99059fF775485246999027B3197955"),
      ].map(async (token) => reader.priceRead({ token, contracts: portalContracts }, { signal })),
    );
    expect(refusals).toStrictEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "no_price_read" })),
    );
    await expect(reader.priceRead({ token: taxToken, contracts: {} }, { signal })).rejects.toThrow(
      expect.objectContaining({ code: "flap.no_contract" }),
    );
  });

  it("declares the swap and the launch wallet's create call, the Portal as spender, no deadline", () => {
    expect(venueOver(scriptedPortal()).contracts).toStrictEqual([
      {
        chain: bscChain,
        names: ["portal"],
        calls: [
          { contract: "portal", abi: swapFunctionJson, walletInputs: [] },
          {
            contract: "portal",
            abi: newTokenFunctionJson,
            walletInputs: [],
            isLaunchWalletOnly: true,
          },
        ],
        spenders: ["portal"],
        noDeadline: true,
      },
    ]);
  });

  it("declares without reading a chain what the venue it makes declares", () => {
    const { id, contracts } = venueOver(scriptedPortal());
    expect(flapDeclaration([bscChain])).toStrictEqual({ id, contracts });
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
