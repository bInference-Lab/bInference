import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefSchema,
  BinferenceError,
  type ChainRef,
  chainRefSchema,
  isTxHash,
  type StakingVenue,
  type TxDraft,
  type TxHash,
} from "@binference/plugin-sdk";
import {
  decodeEvmDraft,
  type RpcCall,
  type RpcFailover,
  type RpcReply,
} from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  keccak256,
  multicall3Abi,
  numberToHex,
  toHex,
} from "viem";
import { z } from "zod";
import { createListaVenue } from "../lista-venue.js";
import { answerView, type ModelAddresses, runCall } from "./lista-answers.js";
import { createModel, type ListaModel, type ModelLog, snapshot } from "./lista-model.js";

/** BSC's chain, on which the world's Lista runs. */
export const listaChain: ChainRef = chainRefSchema.parse("eip155:56");
/** Lista's stake manager on BSC, as the chain registry lists it. */
export const stakeManagerAddress: Address = "0x1adB950d8bB3dA4bE104211D5AB038628e477fE6";
/** slisBNB on BSC, as the chain registry lists it. */
export const slisBnbAddress: Address = "0xB0b84D294e0C75A6abe60171b70edEb2EFd14A1B";
/** StakeHub on BSC, whose unbonding time the world reads. */
export const stakeHubAddress: Address = "0x0000000000000000000000000000000000002002";
/** Multicall3 on BSC, which batches the world's reads. */
export const multicallAddress: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const coin = assetRefSchema.parse("eip155:56/slip44:714");
const receipt = assetRefSchema.parse(`eip155:56/erc20:${slisBnbAddress}`);
const addresses: ModelAddresses = {
  manager: stakeManagerAddress,
  token: slisBnbAddress,
  stakeHub: stakeHubAddress,
  multicall: multicallAddress,
};

/** A mined transaction, as a node answers its receipt and its body. */
interface Mined {
  readonly block: bigint;
  readonly status: Hex;
  readonly logs: readonly ModelLog[];
  readonly from: Address;
  readonly to: Address;
  readonly input: Hex;
}

/** Lista's world for tests: the venue over a model of its stake manager, and the model's controls. */
export interface ListaWorld {
  readonly venue: StakingVenue;
  readonly pool: AccountRef;
  readonly coin: AssetRef;
  readonly receipt: AssetRef;
  /** Runs drafts as the chain would, each in a block of its own, and answers the moves' hashes. */
  run(drafts: readonly TxDraft[]): readonly TxHash[];
  /** Moves the chain's time on by whole seconds. */
  wait(seconds: number): void;
  pause(): void;
  holdQueue(): void;
  releaseQueue(): void;
  /** Marks every endpoint down, so each read rejects. */
  goDown(): void;
  /** The methods asked of the RPC, in order. */
  readonly asked: readonly string[];
}

const hex = z.templateLiteral(["0x", z.string()]);

// Lista's numbers on BSC on 2026-11-02 at block 131,301,081: 1 slisBNB for 1.039342452779596239
// BNB, a least withdrawal of 0.001 BNB, 15% kept of rewards, StakeHub's 7-day unbonding time.
const bscStart = {
  supply: 10n ** 24n,
  pooled: 1_039_342_452_779_596_239_000_000n,
  minBnb: 10n ** 15n,
  synFee: 1_500_000_000n,
  unbondPeriod: 7n * 86_400n,
  time: 1_793_000_000n,
};

function aggregate(model: ListaModel, data: Hex): Hex {
  const call = decodeFunctionData({ abi: multicall3Abi, data });
  if (call.functionName !== "aggregate3") {
    throw new BinferenceError({ code: "world.bad_call", message: "Only aggregate3 is served." });
  }
  const result = call.args[0].map(({ target, callData }) => {
    const answer = answerView(model, addresses, { to: target, data: callData });
    return { success: answer !== undefined, returnData: answer ?? "0x" };
  });
  return encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result });
}

interface WorldState {
  model: ListaModel;
  isDown: boolean;
  readonly history: Map<bigint, ListaModel>;
  readonly mined: Map<string, Mined>;
  readonly asked: string[];
}

function modelAt(state: WorldState, block: string): ListaModel {
  if (block === "latest" || BigInt(block) === state.model.block) {
    return state.model;
  }
  const found = state.history.get(BigInt(block));
  if (found === undefined) {
    throw new BinferenceError({ code: "world.no_block", message: "No such block." });
  }
  return found;
}

function answerOf<T>(state: WorldState, call: RpcCall<T>) {
  if (call.method === "eth_getTransactionReceipt" || call.method === "eth_getTransactionByHash") {
    const [hash] = z.tuple([hex]).parse(call.params);
    const found = state.mined.get(hash);
    if (found === undefined) {
      return null;
    }
    return call.method === "eth_getTransactionByHash"
      ? { from: found.from, to: found.to, input: found.input }
      : { status: found.status, blockNumber: numberToHex(found.block), logs: found.logs };
  }
  const [{ to, data }, block] = z
    .tuple([z.object({ to: hex, data: hex }), z.string()])
    .parse(call.params);
  return getAddress(to) === multicallAddress ? aggregate(modelAt(state, block), data) : undefined;
}

// A node's reply to a call the model answered: a revert when it has no answer.
function replyOf<T>(call: RpcCall<T>, value: ReturnType<typeof answerOf>): RpcReply<T> {
  if (value === undefined) {
    return { kind: "error", endpoint: "world", code: 3, message: "execution reverted" };
  }
  return { kind: "result", endpoint: "world", value: call.result.parse(value) };
}

const rpcDown = (): BinferenceError =>
  new BinferenceError({ code: "chain.rpc_down", message: "No node answers.", retryable: true });

function worldRpc(state: WorldState): RpcFailover {
  const request = async <T>(call: RpcCall<T>): Promise<RpcReply<T>> => {
    call.signal.throwIfAborted();
    if (state.isDown) {
      throw rpcDown();
    }
    state.asked.push(call.method);
    return replyOf(call, answerOf(state, call));
  };
  return { request, health: () => [{ name: "world" }] };
}

interface MinedDraft {
  readonly hash: TxHash;
  readonly isMove: boolean;
  readonly model: ListaModel;
}

// Mines one draft in a block of its own and answers the model after it; a failed call lands
// reverted and changes nothing but the block.
function mine(state: WorldState, draft: TxDraft): MinedDraft {
  const evm = decodeEvmDraft(draft);
  if (!evm.ok) {
    throw new BinferenceError({ code: "world.bad_call", message: "Not an EVM draft." });
  }
  const { from, to, value, data } = evm.value;
  state.history.set(state.model.block, snapshot(state.model));
  const block = { ...state.model, block: state.model.block + 1n, time: state.model.time + 3n };
  const base = { block: block.block, from, to, input: data };
  const hash = keccak256(toHex(`${String(state.mined.size)}:${draft.payload}`));
  if (!isTxHash(hash)) {
    throw new BinferenceError({
      code: "world.bad_hash",
      message: "A hash outside the id grammar.",
    });
  }
  const isMove = getAddress(to) === stakeManagerAddress;
  try {
    const ran = runCall(block, addresses, { from, to, value, data });
    state.mined.set(hash, { ...base, status: "0x1", logs: ran.logs });
    return { hash, isMove, model: ran.model };
  } catch {
    state.mined.set(hash, { ...base, status: "0x0", logs: [] });
    return { hash, isMove, model: block };
  }
}

/** Lista's world on BSC's numbers, with the venue reading it through a model RPC. */
export function createListaWorld(): ListaWorld {
  const state: WorldState = {
    model: createModel(bscStart),
    isDown: false,
    history: new Map(),
    mined: new Map(),
    asked: [],
  };
  const venue = createListaVenue({
    chain: listaChain,
    coin,
    receipt,
    rpc: worldRpc(state),
    contracts: { "stake-manager": accountRefSchema.parse(`eip155:56:${stakeManagerAddress}`) },
    stakeHub: accountRefSchema.parse(`eip155:56:${stakeHubAddress}`),
    multicall: accountRefSchema.parse(`eip155:56:${multicallAddress}`),
  });
  const change = (edit: Partial<ListaModel>) => {
    state.model = { ...state.model, ...edit };
  };
  return {
    venue,
    pool: accountRefSchema.parse(`eip155:56:${stakeManagerAddress}`),
    coin,
    receipt,
    run: (drafts) =>
      drafts.flatMap((draft) => {
        const mined = mine(state, draft);
        state.model = mined.model;
        return mined.isMove ? [mined.hash] : [];
      }),
    wait: (seconds) => {
      const blocks = BigInt(Math.ceil(seconds / 3));
      state.history.set(state.model.block, snapshot(state.model));
      change({ time: state.model.time + BigInt(seconds), block: state.model.block + blocks });
    },
    pause: () => change({ paused: true }),
    holdQueue: () => change({ isHeld: true }),
    releaseQueue: () => change({ isHeld: false }),
    goDown: () => {
      state.isDown = true;
    },
    asked: state.asked,
  };
}
