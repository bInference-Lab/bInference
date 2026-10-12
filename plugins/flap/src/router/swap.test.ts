import { accountRefSchema, type BuildRequest, type TxDraft } from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseEther,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { swapCallData } from "../portal/portal-calls.js";
import {
  bnb,
  portalContracts,
  recordedWallet,
  scriptedPortal,
  taxToken,
  usdt,
  usdtToken,
  venueOver,
} from "../testing/portal-fixtures.js";

const live = (): AbortSignal => new AbortController().signal;
const portal: Address = "0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0";
const taxTokenAddress: Address = "0x7270576A906EAe19a995273695ec223056bD7777";
const usdtAddress: Address = "0x55d398326f99059fF775485246999027B3197955";

function buildOf(
  request: Pick<BuildRequest, "amountIn" | "assetOut">,
  minOut: bigint,
): BuildRequest {
  return {
    wallet: recordedWallet,
    ...request,
    contracts: portalContracts,
    quote: { expectedOut: { asset: request.assetOut, base: minOut }, priceImpactBps: 100 },
    minOut: { asset: request.assetOut, base: minOut },
    deadlineMs: 1_800_000_060_000,
  } as BuildRequest;
}

function callOf(draft: TxDraft | undefined) {
  const call = draft === undefined ? undefined : decodeEvmDraft(draft);
  if (call?.ok !== true) {
    throw new Error("The draft is no EVM call.");
  }
  return call.value;
}

function portalDraft(data: Hex, value: bigint): TxDraft {
  return encodeEvmDraft({
    from: recordedWallet,
    to: accountRefSchema.parse(`eip155:56:${portal}`),
    value,
    data,
  });
}

const swapArgs = {
  inputToken: zeroAddress,
  outputToken: taxTokenAddress,
  inputAmount: parseEther("0.1"),
  minOutputAmount: 5n,
  permitData: "0x",
} as const;

describe("flap trade calls", () => {
  it("builds a buy with BNB as one call to the Portal that sends the input as its value", async () => {
    const venue = venueOver(scriptedPortal());
    const request = buildOf(
      { amountIn: { asset: bnb, base: parseEther("0.1") }, assetOut: taxToken },
      5n,
    );
    const drafts = await venue.build(request, { signal: live() });
    expect(drafts.map(callOf)).toStrictEqual([
      {
        from: "0x000000000000000000000000000000000000bEEF",
        to: portal,
        value: parseEther("0.1"),
        data: swapCallData(swapArgs),
      },
    ]);
    expect(drafts.map((draft) => venue.decode(draft))).toStrictEqual([
      {
        ok: true,
        value: { recipient: recordedWallet, amountIn: request.amountIn, minOut: request.minOut },
      },
    ]);
  });

  it("builds a sale as an exact approval of the Portal, then the call", async () => {
    const venue = venueOver(scriptedPortal());
    const amountIn = { asset: usdtToken, base: parseEther("100000") };
    const drafts = await venue.build(buildOf({ amountIn, assetOut: usdt }, 7n), { signal: live() });
    const approve = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [portal, parseEther("100000")],
    });
    expect(drafts.map(callOf)).toMatchObject([
      { to: "0x649216A8Bf562728fB5059a6BF842f7300C77777", value: 0n, data: approve },
      {
        to: portal,
        value: 0n,
        data: swapCallData({
          inputToken: "0x649216A8Bf562728fB5059a6BF842f7300C77777",
          outputToken: usdtAddress,
          inputAmount: parseEther("100000"),
          minOutputAmount: 7n,
          permitData: "0x",
        }),
      },
    ]);
    expect(drafts.map((draft) => venue.decode(draft).ok)).toStrictEqual([false, true]);
  });

  it.each([
    [
      "a call with a permit",
      portalDraft(swapCallData({ ...swapArgs, permitData: "0x01" }), swapArgs.inputAmount),
    ],
    ["a coin input sent short", portalDraft(swapCallData(swapArgs), 1n)],
    [
      "a token input sent with value",
      portalDraft(swapCallData({ ...swapArgs, inputToken: usdtAddress }), 1n),
    ],
    [
      "a trade of one asset for itself",
      portalDraft(swapCallData({ ...swapArgs, outputToken: zeroAddress }), swapArgs.inputAmount),
    ],
    ["another function of the Portal", portalDraft("0x12345678", 0n)],
    [
      "a call on another chain",
      { ...portalDraft(swapCallData(swapArgs), swapArgs.inputAmount), chain: "eip155:1" },
    ],
  ])("reads %s as an unknown call", (_case, draft) => {
    expect(venueOver(scriptedPortal()).decode(draft as TxDraft)).toStrictEqual({
      ok: false,
      error: "unknown_call",
    });
  });

  it("refuses to build a pair it cannot name, or without the Portal", async () => {
    const venue = venueOver(scriptedPortal());
    const elsewhere = buildOf({ amountIn: { asset: bnb, base: 1n }, assetOut: taxToken }, 1n);
    await expect(
      venue.build({ ...elsewhere, contracts: {} }, { signal: live() }),
    ).rejects.toMatchObject({ code: "flap.no_contract" });
    await expect(
      venue.build(
        {
          ...elsewhere,
          wallet: accountRefSchema.parse("eip155:1:0x000000000000000000000000000000000000bEEF"),
        },
        { signal: live() },
      ),
    ).rejects.toMatchObject({ code: "flap.no_route" });
  });
});
