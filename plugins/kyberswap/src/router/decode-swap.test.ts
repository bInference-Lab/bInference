import { accountRefSchema, type TxDraft } from "@binference/plugin-sdk";
import { encodeEvmDraft } from "@binference/plugin-sdk/evm";
import {
  concat,
  decodeFunctionData,
  encodeFunctionData,
  type Hex,
  parseAbi,
  slice,
  toHex,
  zeroAddress,
} from "viem";
import { describe, expect, it } from "vitest";
import { buyBuild } from "../testing/recorded-buy.js";
import { sellBuild } from "../testing/recorded-sell.js";
import { recordedDeadlineSec, recordedWallet } from "../testing/recorded-terms.js";
import { bnb, scriptedApi, usdt, venueOver } from "../testing/venue-fixtures.js";

const abi = parseAbi([
  "struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }",
  "function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)",
]);
const router = accountRefSchema.parse("eip155:56:0x6131B5fae19EA4f9D964eAc0408E4408b66337b5");
const executor = accountRefSchema.parse("eip155:56:0x8F10B468b06c6FD214B65F87778827F7D113f996");
const other = "0x000000000000000000000000000000000000dEaD";
const venue = venueOver(scriptedApi({}));

function calldataIn(build: string): Hex {
  const data = /"data": "(0x[0-9a-f]+)"/.exec(build)?.[1];
  if (data === undefined) {
    throw new Error("The recorded build holds no calldata.");
  }
  return `0x${data.slice(2)}`;
}

const buyData = calldataIn(buyBuild);
const sellData = calldataIn(sellBuild);
const [buyExecution] = decodeFunctionData({ abi, data: buyData }).args;
const [sellExecution] = decodeFunctionData({ abi, data: sellData }).args;

type Execution = typeof buyExecution;
type Description = Execution["desc"];

function draftOf(data: Hex, value: bigint, to = router): TxDraft {
  return encodeEvmDraft({ from: recordedWallet, to, value, data });
}

function buyWith(change: Partial<Execution>, desc: Partial<Description> = {}): TxDraft {
  const execution = { ...buyExecution, ...change, desc: { ...buyExecution.desc, ...desc } };
  return draftOf(encodeFunctionData({ abi, functionName: "swap", args: [execution] }), 10n ** 17n);
}

function sellWith(desc: Partial<Description>): TxDraft {
  const execution = { ...sellExecution, desc: { ...sellExecution.desc, ...desc } };
  return draftOf(encodeFunctionData({ abi, functionName: "swap", args: [execution] }), 0n);
}

// The executor data with its payload's word `index` set to `word`; KyberSwap's signature no longer
// covers it, which only the chain would notice.
function payloadWith(index: number, word: Hex): Hex {
  const payloadStart = 20 + 0xe0 + 32;
  const at = payloadStart + index * 32;
  const data = buyExecution.targetData;
  return concat([slice(data, 0, at), word, slice(data, at + 32)]);
}

describe("decodes kyberswap calls", () => {
  it("reads a recorded coin buy: recipient, exact input, minimum and the executor's deadline", () => {
    expect(venue.decode(draftOf(buyData, 10n ** 17n))).toStrictEqual({
      ok: true,
      value: {
        recipient: recordedWallet,
        amountIn: { asset: bnb, base: 10n ** 17n },
        minOut: { asset: usdt, base: 76_321_695_368_036_993_739n },
        deadlineMs: recordedDeadlineSec * 1000,
      },
    });
  });

  it("reads a recorded token sale", () => {
    expect(venue.decode(draftOf(sellData, 0n))).toStrictEqual({
      ok: true,
      value: {
        recipient: recordedWallet,
        amountIn: { asset: usdt, base: 50n * 10n ** 18n },
        minOut: { asset: bnb, base: 64_845_633_187_862_229n },
        deadlineMs: recordedDeadlineSec * 1000,
      },
    });
  });

  it.each<[string, TxDraft]>([
    ["a fee to another account", buyWith({}, { feeReceivers: [other], feeAmounts: [1n] })],
    ["a fee amount alone", buyWith({}, { feeAmounts: [1n] })],
    ["a permit", buyWith({}, { permit: "0x01" })],
    ["the router's partial fill flag", buyWith({}, { flags: 0x201n })],
    ["the router's fee on output flag", buyWith({}, { flags: 0x240n })],
    ["an approve target", buyWith({ approveTarget: other })],
    ["a zero recipient", buyWith({}, { dstReceiver: zeroAddress })],
    ["a recipient the executor does not pay", buyWith({}, { dstReceiver: other })],
    ["a coin input it does not send in full", draftOf(buyData, 10n ** 17n - 1n)],
    [
      "a coin input also moved as a token",
      buyWith({}, { srcReceivers: [other], srcAmounts: [1n] }),
    ],
    ["a token input sent with coin", draftOf(sellData, 1n)],
    ["a token input it does not move in full", sellWith({ srcAmounts: [1n] })],
    ["token amounts without receivers", sellWith({ srcReceivers: [] })],
    ["a call aimed at its executor", draftOf(buyData, 10n ** 17n, executor)],
    ["calldata of another function", draftOf("0x095ea7b3", 0n)],
    ["executor data too short to read", buyWith({ targetData: "0x01" })],
    [
      "executor data with no payload",
      buyWith({ targetData: slice(buyExecution.targetData, 0, 100) }),
    ],
    [
      "a recipient word wider than an address",
      buyWith({ targetData: payloadWith(0, toHex(2n ** 200n, { size: 32 })) }),
    ],
    [
      "a deadline past what a number holds in milliseconds",
      buyWith({ targetData: payloadWith(8, toHex(2n ** 60n, { size: 32 })) }),
    ],
    ["a draft that is no EVM call", { ...draftOf(buyData, 10n ** 17n), payload: "0x01" }],
    [
      "a draft on a chain it does not trade on",
      encodeEvmDraft({
        from: accountRefSchema.parse(recordedWallet.replace("eip155:56:", "eip155:1:")),
        to: accountRefSchema.parse(router.replace("eip155:56:", "eip155:1:")),
        value: 10n ** 17n,
        data: buyData,
      }),
    ],
  ])("answers unknown call for %s", (_case, draft) => {
    expect(venue.decode(draft)).toStrictEqual({ ok: false, error: "unknown_call" });
  });
});
