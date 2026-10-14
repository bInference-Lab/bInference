import {
  accountRefSchema,
  assetRefSchema,
  bpsSchema,
  type QuoteRequest,
} from "@binference/plugin-sdk";
import { decodeEvmDraft, encodeEvmDraft } from "@binference/plugin-sdk/evm";
import { draftAt, hostBuildRequest, successOf } from "@binference/plugin-sdk/testing";
import { type Address, encodeFunctionData, erc20Abi, parseEther, zeroAddress } from "viem";
import { describe, expect, it } from "vitest";
import { tradeCallData } from "../contracts/genius-calls.js";
import type { RecordedCall } from "../testing/recorded-answers.js";
import { scriptedChain } from "../testing/recorded-chain.js";
import {
  bnb,
  contractsWith,
  launchAnswer,
  olderCurve,
  partsOver,
  recordedWallet,
  requestOf,
  stackCurve,
  stackToken,
  usdt,
} from "../testing/venue-fixtures.js";
import type { VenueParts } from "../venue-parts.js";
import { buildTrade } from "./build-trade.js";
import { decodeTrade } from "./decode-trade.js";

const live = (): AbortSignal => new AbortController().signal;
const wallet: Address = "0x000000000000000000000000000000000000bEEF";
const quote = {
  expectedOut: { asset: stackToken, base: 1_000n },
  priceImpactBps: bpsSchema.parse(0),
};
const terms = { deadlineMs: 1_800_000_060_000 };

function partsWith(changes: readonly (readonly [string, RecordedCall])[] = []): VenueParts {
  return partsOver(scriptedChain({ calls: new Map(changes) }));
}

async function built(request: QuoteRequest, parts: VenueParts = partsWith()) {
  const expectedOut = { asset: request.assetOut, base: 1_000n };
  const drafts = await buildTrade(
    hostBuildRequest(request, { ...quote, expectedOut }, terms),
    parts,
    live(),
  );
  return { drafts, parts, calls: drafts.map((draft) => decodeEvmDraft(draft)) };
}

describe("geniusfun trades", () => {
  it("buys with the coin in one call to the launch's curve, which pays the wallet", async () => {
    const request = requestOf({ asset: bnb, base: parseEther("0.1") }, stackToken);
    const { drafts, parts, calls } = await built(request);
    const data = tradeCallData({
      side: "buy",
      amountIn: parseEther("0.1"),
      minOut: 995n,
      recipient: wallet,
    });
    expect(calls).toStrictEqual([
      { ok: true, value: { from: wallet, to: stackCurve, value: parseEther("0.1"), data } },
    ]);
    expect(drafts.map((draft) => decodeTrade(draft, parts))).toStrictEqual([
      {
        ok: true,
        value: {
          recipient: recordedWallet,
          amountIn: request.amountIn,
          minOut: { asset: stackToken, base: 995n },
        },
      },
    ]);
  });

  it("sells after an exact approval of the curve, with no coin sent", async () => {
    const request = requestOf({ asset: stackToken, base: parseEther("1000000") }, bnb);
    const { drafts, parts, calls } = await built(request);
    const approve = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [stackCurve, parseEther("1000000")],
    });
    expect(calls).toMatchObject([
      {
        ok: true,
        value: { to: "0x7D227534c39C41033Af86DBC8aDE1BF8D68b0157", value: 0n, data: approve },
      },
      { ok: true, value: { to: stackCurve, value: 0n } },
    ]);
    expect(drafts.map((draft) => decodeTrade(draft, parts))).toStrictEqual([
      { ok: false, error: "unknown_call" },
      {
        ok: true,
        value: {
          recipient: recordedWallet,
          amountIn: request.amountIn,
          minOut: { asset: bnb, base: 995n },
        },
      },
    ]);
  });

  it("buys with a quote token after an exact approval of the curve, for a curve against it", async () => {
    const token: Address = "0x00000000000000000000000000000000000Ba5E5";
    const asset = assetRefSchema.parse(`eip155:56/erc20:${token}`);
    const changes = [
      launchAnswer("0x37eE8AeE29C5efd3C1A7edA6dF3F510779928a37", {
        token,
        curve: stackCurve,
        pairToken: "0x55d398326f99059fF775485246999027B3197955",
      }),
      launchAnswer("0x78EAE9537C0ef90DFe9B7ae964682Fe8138afe31", {
        token,
        curve: zeroAddress,
        pairToken: zeroAddress,
        exists: false,
      }),
    ];
    const request = requestOf({ asset: usdt, base: parseEther("10") }, asset);
    const { drafts, parts, calls } = await built(request, partsWith(changes));
    expect(calls).toMatchObject([
      { ok: true, value: { to: "0x55d398326f99059fF775485246999027B3197955", value: 0n } },
      { ok: true, value: { to: stackCurve, value: 0n } },
    ]);
    expect(decodeTrade(draftAt(drafts, 1), parts)).toMatchObject({
      ok: true,
      value: { amountIn: { asset: usdt, base: parseEther("10") }, minOut: { asset } },
    });
  });

  it.each([
    [
      "a curve that is not the token's own",
      { ...requestOf({ asset: bnb, base: 1n }, stackToken), contracts: contractsWith(olderCurve) },
    ],
    ["a pair the curve does not trade", requestOf({ asset: usdt, base: 1n }, stackToken)],
    ["two quote assets", requestOf({ asset: bnb, base: 1n }, usdt)],
  ])("refuses to build for %s", async (_case, request) => {
    await expect(built(request)).rejects.toMatchObject({ code: "geniusfun.no_route" });
  });

  it("reads no call to a curve it never read, nor one that sends other coin", async () => {
    const request = requestOf({ asset: bnb, base: parseEther("0.1") }, stackToken);
    const { drafts, parts } = await built(request);
    const buy = draftAt(drafts, 0);
    const { to, data } = successOf(decodeEvmDraft(buy));
    const resent = encodeEvmDraft({
      from: recordedWallet,
      to: accountRefSchema.parse(`eip155:56:${to}`),
      value: 1n,
      data,
    });
    expect(decodeTrade(resent, parts)).toStrictEqual({ ok: false, error: "unknown_call" });
    expect(decodeTrade(buy, partsWith())).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
