import { assetRefSchema } from "@binference/chain";
import { createManualClock } from "@binference/core/testing";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  multicall3Abi,
  numberToHex,
} from "viem";
import { describe, expect, it } from "vitest";
import { erc20AssetRef, type EvmChain } from "../evm-chain.js";
import { createRpcFailover } from "../rpc/create-rpc-failover.js";
import {
  createFakeRpcHttp,
  type FakeRpcAnswer,
  type FakeRpcRequest,
  fakeRpcNode,
} from "../testing/fake-rpc-http.js";
import { readEvmBalances } from "./read-balances.js";

const url = "https://node.invalid/";
const chain = {
  ref: "eip155:56",
  chainId: 56,
  name: "Test BSC",
  nativeAsset: "eip155:56/slip44:714",
  nativeSymbol: "BNB",
  nativeDecimals: 18,
} as EvmChain;
const holder = getAddress("0x8894e0a0c962cb723c1976a4421c95949be2d4e3");
const multicall = getAddress("0xca11bde05977b3631167028862be2a173976ca11");
const tokenA = getAddress("0x55d398326f99059ff775485246999027b3197955");
const tokenB = getAddress("0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d");
const coin = chain.nativeAsset;
const usdt = erc20AssetRef(chain, tokenA);
const usdc = erc20AssetRef(chain, tokenB);
const huge = 18_446_744_073_709_551_617n;

function node(answer: (request: FakeRpcRequest) => FakeRpcAnswer) {
  const asked: FakeRpcRequest[] = [];
  const rpc = createRpcFailover({
    endpoints: [{ name: "node", url }],
    http: createFakeRpcHttp({
      [url]: fakeRpcNode((request) => {
        asked.push(request);
        return answer(request);
      }),
    }),
    clock: createManualClock(),
    timeoutMs: 1_000,
    restMs: 1_000,
  });
  return { rpc, asked };
}

const word = (value: bigint): Hex => numberToHex(value, { size: 32 });

function aggregated(answers: readonly { readonly success: boolean; readonly returnData: Hex }[]) {
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: answers });
}

// The calls an aggregate3 request asked, as target and function selector.
function callsOf(request: FakeRpcRequest): readonly (readonly [Address, Hex])[] {
  const [call] = request.params as readonly [{ readonly data: Hex }];
  const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
  const [calls] = decoded.args as readonly [readonly { target: Address; callData: Hex }[]];
  return calls.map(({ target, callData }) => [target, callData.slice(0, 10) as Hex]);
}

const signal = new AbortController().signal;
const request = (assets: readonly (typeof coin)[]) => ({
  chain,
  holder,
  assets,
  multicall,
  signal,
});

describe("read evm balances", () => {
  it("reads the coin alone through eth_getBalance, once for every time it is asked", async () => {
    const { rpc, asked } = node(() => ({ result: numberToHex(huge) }));
    await expect(readEvmBalances(rpc, request([coin, coin]))).resolves.toStrictEqual([
      { asset: coin, base: huge },
      { asset: coin, base: huge },
    ]);
    expect(asked.map(({ method, params }) => [method, params])).toStrictEqual([
      ["eth_getBalance", [holder, "latest"]],
    ]);
  });

  it("reads the coin and every token in one Multicall3 call, in the order asked", async () => {
    const { rpc, asked } = node(() => ({
      result: aggregated([
        { success: true, returnData: word(7n) },
        { success: true, returnData: word(huge) },
        { success: true, returnData: word(0n) },
      ]),
    }));
    await expect(readEvmBalances(rpc, request([usdt, coin, usdc]))).resolves.toStrictEqual([
      { asset: usdt, base: 7n },
      { asset: coin, base: huge },
      { asset: usdc, base: 0n },
    ]);
    expect(asked.map((call) => call.method)).toStrictEqual(["eth_call"]);
    expect(asked.map(callsOf)).toStrictEqual([
      [
        [tokenA, "0x70a08231"],
        [multicall, "0x4d2301cc"],
        [tokenB, "0x70a08231"],
      ],
    ]);
  });

  it("refuses an asset of another chain or kind before it asks anything", async () => {
    const { rpc, asked } = node(() => ({ result: "0x0" }));
    const elsewhere = assetRefSchema.parse(`eip155:1/erc20:${tokenA}`);
    const nft = assetRefSchema.parse(`eip155:56/erc721:${tokenA}`);
    await expect(readEvmBalances(rpc, request([coin, elsewhere]))).rejects.toMatchObject({
      code: "chain.bad_balances",
      details: { asset: elsewhere },
    });
    await expect(readEvmBalances(rpc, request([nft]))).rejects.toMatchObject({
      code: "chain.bad_balances",
    });
    expect(asked).toStrictEqual([]);
  });

  it.each([
    ["reverts", { success: false, returnData: "0x" }],
    ["answers no word", { success: true, returnData: "0x" }],
    ["answers two words", { success: true, returnData: `${word(1n)}${word(2n).slice(2)}` }],
  ] as const)("refuses a balance whose call %s, naming the asset", async (_case, answer) => {
    const { rpc } = node(() => ({
      result: aggregated([{ success: true, returnData: word(1n) }, answer]),
    }));
    await expect(readEvmBalances(rpc, request([coin, usdc]))).rejects.toMatchObject({
      code: "chain.balance_unreadable",
      details: { asset: usdc },
    });
  });

  it("refuses an answer that holds fewer balances than were asked", async () => {
    const { rpc } = node(() => ({ result: aggregated([{ success: true, returnData: word(1n) }]) }));
    await expect(readEvmBalances(rpc, request([usdt, usdc]))).rejects.toMatchObject({
      code: "chain.balance_unreadable",
      details: { asset: usdc },
    });
  });

  it("names the node's error when the call itself fails", async () => {
    const { rpc } = node(() => ({ error: { code: 3, message: "execution reverted" } }));
    await expect(readEvmBalances(rpc, request([usdt]))).rejects.toMatchObject({
      code: "chain.rpc_error",
    });
  });

  it("asks nothing for no assets, and nothing once the signal aborts", async () => {
    const { rpc, asked } = node(() => ({ result: "0x0" }));
    await expect(readEvmBalances(rpc, request([]))).resolves.toStrictEqual([]);
    const reason = new Error("stopped");
    await expect(
      readEvmBalances(rpc, { ...request([coin]), signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(asked).toStrictEqual([]);
  });
});
