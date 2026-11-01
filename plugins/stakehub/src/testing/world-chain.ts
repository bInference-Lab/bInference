import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcCall, RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionResult,
  getAddress,
  type Hex,
  multicall3Abi,
  numberToHex,
  parseAbi,
  parseAbiParameters,
} from "viem";
import { z } from "zod";
import { answerCall } from "./hub-answers.js";
import type { HubModel, ModelEvent } from "./hub-model.js";

/** A world's chain: the model now, its state at each earlier block, and each mined receipt. */
export interface WorldChain {
  readonly model: HubModel;
  readonly history: Map<bigint, HubModel>;
  readonly receipts: Map<string, WorldReceipt>;
  readonly hub: Address;
  readonly multicall: Address;
}

/** A mined transaction's receipt, as a node answers it. */
export interface WorldReceipt {
  readonly status: Hex;
  readonly blockNumber: Hex;
  readonly logs: readonly {
    readonly address: Hex;
    readonly topics: readonly Hex[];
    readonly data: Hex;
  }[];
}

// Multicall3's own reads of the block it runs in, and StakeHub's events, written apart from the
// plugin's encoders.
const headAbi = parseAbi([
  "function getBlockNumber() view returns (uint256)",
  "function getCurrentBlockTimestamp() view returns (uint256)",
]);
const eventsAbi = parseAbi([
  "event Delegated(address indexed operatorAddress, address indexed delegator, uint256 shares, uint256 bnbAmount)",
  "event Undelegated(address indexed operatorAddress, address indexed delegator, uint256 shares, uint256 bnbAmount)",
  "event Claimed(address indexed operatorAddress, address indexed delegator, uint256 bnbAmount)",
]);

const hex = z.templateLiteral(["0x", z.string()]);

/** The log StakeHub writes for a move. */
export function logOf(hub: Address, event: ModelEvent): WorldReceipt["logs"][number] {
  const args = { operatorAddress: event.operator, delegator: event.delegator };
  const topics = encodeEventTopics({ abi: eventsAbi, eventName: event.name, args });
  const data =
    event.name === "Claimed"
      ? encodeAbiParameters(parseAbiParameters("uint256"), [event.bnbAmount])
      : encodeAbiParameters(parseAbiParameters("uint256, uint256"), [
          event.shares ?? 0n,
          event.bnbAmount,
        ]);
  return { address: hub, topics: topics.filter((topic): topic is Hex => topic !== null), data };
}

function headAnswer(model: HubModel, data: Hex): Hex {
  const { functionName } = decodeFunctionData({ abi: headAbi, data });
  const result = functionName === "getBlockNumber" ? model.clock.block : model.clock.time;
  return encodeFunctionResult({ abi: headAbi, functionName, result });
}

function aggregate(chain: WorldChain, model: HubModel, data: Hex): Hex {
  const call = decodeFunctionData({ abi: multicall3Abi, data });
  if (call.functionName !== "aggregate3") {
    throw new BinferenceError({ code: "world.bad_call", message: "Only aggregate3 is served." });
  }
  const result = call.args[0].map(({ target, callData }) => {
    const answer =
      getAddress(target) === chain.multicall
        ? headAnswer(model, callData)
        : answerCall(model, chain.hub, { to: target, data: callData });
    return { success: answer !== undefined, returnData: answer ?? "0x" };
  });
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });
}

// The model at a block the chain mined: the latest, or an earlier one's state as it ended.
function modelAt(chain: WorldChain, block: string): HubModel {
  if (block === "latest" || block === numberToHex(chain.model.clock.block)) {
    return chain.model;
  }
  const found = chain.history.get(BigInt(block));
  if (found === undefined) {
    throw new BinferenceError({ code: "world.no_block", message: "No such block." });
  }
  return found;
}

type WorldAnswer =
  | Hex
  | WorldReceipt
  | { readonly number: Hex; readonly timestamp: Hex }
  | null
  | undefined;

function valueOf<T>(chain: WorldChain, call: RpcCall<T>): WorldAnswer {
  const { model } = chain;
  if (call.method === "eth_getBlockByNumber") {
    return { number: numberToHex(model.clock.block), timestamp: numberToHex(model.clock.time) };
  }
  if (call.method === "eth_getTransactionReceipt") {
    const [hash] = z.tuple([hex]).parse(call.params);
    return chain.receipts.get(hash) ?? null;
  }
  if (call.method === "eth_getCode") {
    const [account, block] = z.tuple([hex, z.string()]).parse(call.params);
    return modelAt(chain, block).coded.has(getAddress(account)) ? "0x6080" : "0x";
  }
  const [{ to, data }, block] = z
    .tuple([z.object({ to: hex, data: hex }), z.string()])
    .parse(call.params);
  return getAddress(to) === chain.multicall
    ? aggregate(chain, modelAt(chain, block), data)
    : undefined;
}

/** The world's RPC failover: it records each method asked, and rejects them all once down. */
export function worldRpc(
  chain: WorldChain,
  state: { readonly asked: string[]; readonly isDown: () => boolean },
): RpcFailover {
  return {
    request: async <T>(call: RpcCall<T>): Promise<RpcReply<T>> => {
      call.signal.throwIfAborted();
      if (state.isDown()) {
        throw new BinferenceError({
          code: "chain.rpc_down",
          message: "No node answers.",
          retryable: true,
        });
      }
      state.asked.push(call.method);
      const value = valueOf(chain, call);
      return await Promise.resolve(
        value === undefined
          ? { kind: "error", endpoint: "world", code: 3, message: "execution reverted" }
          : { kind: "result", endpoint: "world", value: call.result.parse(value) },
      );
    },
    health: () => [{ name: "world" }],
  };
}
