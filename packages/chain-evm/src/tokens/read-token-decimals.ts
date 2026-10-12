import type { ReadAnswer } from "@binference/chain";
import { type Address, decodeFunctionResult, encodeFunctionData, erc20Abi, type Hex } from "viem";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { numberAnswer } from "../watching/pool-state.js";
import { readAggregate } from "../watching/read-aggregate.js";
import { batchGasOf, readIsolated } from "../watching/read-isolated.js";

const decimalsCall = encodeFunctionData({ abi: erc20Abi, functionName: "decimals" });
// ERC-20 writes decimals as a `uint8`; a token that answers more is not read.
const maxDecimals = 255n;

// One `uint8` word as a number; any other answer is none.
function decimalsOf(answer: ReadAnswer): number | undefined {
  const word = numberAnswer(answer);
  if (word === undefined || word > maxDecimals || answer === undefined) {
    return undefined;
  }
  const data: Hex = `0x${answer.slice(2)}`;
  return decodeFunctionResult({ abi: erc20Abi, functionName: "decimals", data });
}

/**
 * The decimals of each ERC-20 token, all read in one Multicall3 call at the latest block, bounded
 * in gas. A token whose `decimals()` reverts, answers anything but one `uint8` word, or fails the
 * whole batch, as one that burns its gas does, is left out: a batch the node refuses is read again
 * in halves (decision 0194). Rejects when no endpoint answers, and with the signal's reason once it
 * aborts.
 */
export async function readTokenDecimals(
  rpc: RpcFailover,
  request: {
    readonly multicall: Address;
    readonly tokens: readonly Address[];
    readonly signal: AbortSignal;
  },
): Promise<ReadonlyMap<Address, number>> {
  request.signal.throwIfAborted();
  if (request.tokens.length === 0) {
    return new Map();
  }
  const groups = request.tokens.map((target) => ({
    token: target,
    calls: [{ target, callData: decimalsCall }],
  }));
  const { multicall, signal } = request;
  const isolated = await readIsolated(
    async (calls) =>
      readAggregate(rpc, { multicall, calls, signal, gas: batchGasOf(calls.length) }),
    groups,
  );
  return new Map(
    isolated.answered.flatMap(({ group, answers }) => {
      const decimals = decimalsOf(answers[0]);
      return decimals === undefined ? [] : [[group.token, decimals] as const];
    }),
  );
}
