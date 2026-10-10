import type { Amount, AssetRef } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToBigInt,
  multicall3Abi,
  size,
} from "viem";
import type { EvmChain } from "../evm-chain.js";
import { hexSchema, quantitySchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { aggregatorNativeToken, aggregatorTokenOf } from "../tokens/aggregator-token.js";

/** Whose balances to read, of which assets, and where Multicall3 sits on the chain. */
export interface BalancesRequest {
  readonly chain: EvmChain;
  readonly holder: Address;
  /** The chain's coin and its ERC-20 tokens, in the order the answer keeps. */
  readonly assets: readonly AssetRef[];
  /** Multicall3, which reads the coin and every token in one call. */
  readonly multicall: Address;
  readonly signal: AbortSignal;
}

interface BalanceCall {
  readonly asset: AssetRef;
  readonly target: Address;
  readonly callData: Hex;
  readonly isCoin: boolean;
}

function callOf(request: BalancesRequest, asset: AssetRef): BalanceCall {
  const { chain, holder, multicall } = request;
  const token = aggregatorTokenOf(asset, { chain: chain.ref, nativeAsset: chain.nativeAsset });
  if (token === undefined) {
    throw new BinferenceError({
      code: "chain.bad_balances",
      message: `A balance to read is neither ${chain.name}'s coin nor one of its tokens.`,
      details: { asset },
    });
  }
  if (token === aggregatorNativeToken) {
    const callData = encodeFunctionData({
      abi: multicall3Abi,
      functionName: "getEthBalance",
      args: [holder],
    });
    return { asset, target: multicall, callData, isCoin: true };
  }
  const callData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
  });
  return { asset, target: token, callData, isCoin: false };
}

const wordBytes = 32;

// A call that reverted, or answered anything but one word, holds no balance the reader trusts.
function amountOf(
  call: BalanceCall,
  answer: { readonly success: boolean; readonly returnData: Hex },
): Amount {
  if (!answer.success || size(answer.returnData) !== wordBytes) {
    throw new BinferenceError({
      code: "chain.balance_unreadable",
      message: "A balance could not be read on the chain.",
      details: { asset: call.asset },
    });
  }
  return { asset: call.asset, base: hexToBigInt(answer.returnData) };
}

async function readCoin(
  rpc: RpcFailover,
  request: BalancesRequest,
  calls: readonly BalanceCall[],
): Promise<readonly Amount[]> {
  const base = await requestResult(rpc, {
    method: "eth_getBalance",
    params: [request.holder, "latest"],
    result: quantitySchema,
    signal: request.signal,
  });
  return calls.map(({ asset }) => ({ asset, base }));
}

async function readAll(
  rpc: RpcFailover,
  request: BalancesRequest,
  calls: readonly BalanceCall[],
): Promise<readonly Amount[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [calls.map(({ target, callData }) => ({ target, allowFailure: true, callData }))],
  });
  const answer = await requestResult(rpc, {
    method: "eth_call",
    params: [{ to: request.multicall, data }, "latest"],
    result: hexSchema,
    signal: request.signal,
  });
  const answers = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: "aggregate3",
    data: answer,
  });
  return calls.map((call, index) => {
    const one = answers[index];
    if (one === undefined) {
      throw new BinferenceError({
        code: "chain.balance_unreadable",
        message: "Multicall3 answered fewer balances than were asked.",
        details: { asset: call.asset },
      });
    }
    return amountOf(call, one);
  });
}

/**
 * Reads what `holder` holds now of each asset, in the order asked: the chain's coin through
 * Multicall3's `getEthBalance` and each ERC-20 token through its `balanceOf`, all in one `eth_call`
 * at the latest block; the coin alone through `eth_getBalance`. An asset of another chain, or one
 * that is neither the coin nor an ERC-20 token, is a `chain.bad_balances` fault before anything is
 * asked; a balance call that reverts or answers anything but one word is a
 * `chain.balance_unreadable` fault naming the asset. Rejects with the signal's reason once it
 * aborts.
 */
export async function readEvmBalances(
  rpc: RpcFailover,
  request: BalancesRequest,
): Promise<readonly Amount[]> {
  request.signal.throwIfAborted();
  const calls = request.assets.map((asset) => callOf(request, asset));
  if (calls.length === 0) {
    return [];
  }
  return calls.every(({ isCoin }) => isCoin)
    ? readCoin(rpc, request, calls)
    : readAll(rpc, request, calls);
}
