import { BinferenceError } from "@binference/core";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  multicall3Abi,
  toHex,
} from "viem";
import { hexSchema } from "../rpc/evm-wire.schema.js";
import { requestResult } from "../rpc/request-result.js";
import type { RpcFailover } from "../rpc/rpc-call.js";

/** One read call of a batch: the contract and its calldata. */
export interface AggregateCall {
  readonly target: Address;
  readonly callData: Hex;
}

/** A batch of read calls to ask at one block through Multicall3. */
export interface AggregateRead {
  /** Multicall3 on the chain. */
  readonly multicall: Address;
  readonly calls: readonly AggregateCall[];
  /** The block every call reads; `latest` when absent. */
  readonly block?: bigint;
  readonly signal: AbortSignal;
  /** How long one endpoint may take; the failover's own timeout when absent. */
  readonly timeoutMs?: number;
  /** The block is the newest: a node that has not imported it yet is not at fault. */
  readonly atHead?: boolean;
  /** The endpoint to ask first, such as the one whose poll announced the block. */
  readonly preferEndpoint?: string;
}

// The answer's results, or none for an answer outside `aggregate3`'s shape.
function resultsOf(
  answer: Hex,
): readonly { readonly success: boolean; readonly returnData: Hex }[] | undefined {
  try {
    return decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: answer });
  } catch {
    return undefined;
  }
}

/**
 * Asks every call of the batch at one block in a single `eth_call` of Multicall3's `aggregate3`,
 * each allowed to fail, and answers each call's return data in the batch's order, `undefined` for
 * one that reverted. One request whatever the number of calls, so the batch is never split. An
 * answer with another number of results than calls is a `chain.multicall_mismatch` fault; a
 * revert of the whole batch is `chain.rpc_error`, and no endpoint answering `chain.rpc_down`.
 * Rejects with the signal's reason once it aborts.
 */
export async function readAggregate(
  rpc: RpcFailover,
  read: AggregateRead,
): Promise<readonly (Hex | undefined)[]> {
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: "aggregate3",
    args: [read.calls.map(({ target, callData }) => ({ target, allowFailure: true, callData }))],
  });
  const answer = await requestResult(rpc, {
    method: "eth_call",
    params: [{ to: read.multicall, data }, read.block === undefined ? "latest" : toHex(read.block)],
    result: hexSchema,
    signal: read.signal,
    ...(read.timeoutMs === undefined ? {} : { timeoutMs: read.timeoutMs }),
    ...(read.atHead === true ? { atHead: true } : {}),
    ...(read.preferEndpoint === undefined ? {} : { preferEndpoint: read.preferEndpoint }),
  });
  const results = resultsOf(answer);
  if (results?.length !== read.calls.length) {
    throw new BinferenceError({
      code: "chain.multicall_mismatch",
      message: "Multicall3 answered something other than one result per call.",
      details: { calls: read.calls.length },
    });
  }
  return results.map(({ success, returnData }) => (success ? returnData : undefined));
}
