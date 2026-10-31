import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcCall, RpcFailover, RpcReply } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionData,
  encodeFunctionResult,
  getAddress,
  type Hex,
  labelhash,
  namehash,
  numberToHex,
  parseAbi,
  zeroAddress,
} from "viem";
import { z } from "zod";

/** SPACE ID's registry on BSC, as the chain registry lists it. */
export const registryAddress: Address = "0x08CEd32a7f3eeC915Ba84415e9C07a7286977956";
/** SPACE ID's `.bnb` base registrar on BSC, as the chain registry lists it. */
export const registrarAddress: Address = "0xE3b1D32e43Ce8d658368e2CBFF95D57Ef39Be8a6";

// The four calls a resolution makes, written here apart from the plugin's own encoders.
const abi = parseAbi([
  "function resolver(bytes32 node) view returns (address)",
  "function nameExpires(uint256 id) view returns (uint256)",
  "function addr(bytes32 node) view returns (address)",
  "function name(bytes32 node) view returns (string)",
]);

/** A SPACE ID world on one chain that a test sets up, read through an RPC failover. */
export interface SpaceIdWorld {
  readonly rpc: RpcFailover;
  /** Registers a second-level label of `.bnb` until `expires`, in seconds since the epoch. */
  register(label: string, expires: bigint): void;
  /** Names the node's resolver in the registry; `undefined` clears it. */
  setResolver(name: string, resolver: Address | undefined): void;
  /** Sets the address record a resolver answers for a name; unset records answer zero. */
  setAddress(resolver: Address, name: string, address: Address): void;
  /** Sets the name a reverse resolver answers for an address's reverse record. */
  setReverseName(resolver: Address, address: Address, name: string): void;
  /** Makes every call to the contract revert, as a contract without the function does. */
  breakContract(contract: Address): void;
  /** Gives the account code: a contract's when none is named. */
  setCode(account: Address, code?: Hex): void;
  /** Moves the latest block's time, in seconds since the epoch. */
  setTime(seconds: bigint): void;
  /** Every later request rejects as no node answering. */
  down(): void;
  /** The methods asked, oldest first. */
  asked(): readonly string[];
}

/** The reverse record's name of an address: `<lowercase hex, no 0x>.addr.reverse`. */
export function reverseNameOf(address: Address): string {
  return `${address.slice(2).toLowerCase()}.addr.reverse`;
}

interface WorldState {
  readonly expiries: Map<bigint, bigint>;
  readonly resolvers: Map<Hex, Address>;
  readonly addresses: Map<string, Address>;
  readonly names: Map<string, string>;
  readonly broken: Set<Address>;
  readonly code: Map<Address, Hex>;
  readonly asked: string[];
  time: bigint;
  isDown: boolean;
}

const block = "0x7cd3a2d";
const recordKey = (resolver: Address, node: Hex): string => `${getAddress(resolver)}/${node}`;

type WorldCall = ReturnType<typeof decodeFunctionData<typeof abi>>;

// The registry's resolver and the base registrar's expiry; `undefined` for any other call.
function answerFixed(state: WorldState, target: Address, call: WorldCall): Hex | undefined {
  if (target === registryAddress && call.functionName === "resolver") {
    const result = state.resolvers.get(call.args[0]) ?? zeroAddress;
    return encodeFunctionResult({ abi, functionName: "resolver", result });
  }
  if (target === registrarAddress && call.functionName === "nameExpires") {
    const result = state.expiries.get(call.args[0]) ?? 0n;
    return encodeFunctionResult({ abi, functionName: "nameExpires", result });
  }
  return undefined;
}

// A resolver's address and name records; an unset record answers zero or an empty name.
function answerResolver(state: WorldState, target: Address, call: WorldCall): Hex | undefined {
  if (call.functionName === "addr") {
    const result = state.addresses.get(recordKey(target, call.args[0])) ?? zeroAddress;
    return encodeFunctionResult({ abi, functionName: "addr", result });
  }
  if (call.functionName === "name") {
    const result = state.names.get(recordKey(target, call.args[0])) ?? "";
    return encodeFunctionResult({ abi, functionName: "name", result });
  }
  return undefined;
}

function answerCall(state: WorldState, to: Address, data: Hex): Hex | undefined {
  const call = decodeFunctionData({ abi, data });
  const target = getAddress(to);
  if (state.broken.has(target)) {
    return undefined;
  }
  return answerFixed(state, target, call) ?? answerResolver(state, target, call);
}

const hex = z.templateLiteral(["0x", z.string()]);
const codeParams = z.tuple([hex, z.literal(block)]);
const callParams = z.tuple([z.object({ to: hex, data: hex }), z.literal(block)]);

// Every read but the latest block's must name the latest block, else the params fail to parse.
function valueOf<T>(
  state: WorldState,
  { method, params }: RpcCall<T>,
): Hex | { readonly number: Hex; readonly timestamp: Hex } | undefined {
  if (method === "eth_getBlockByNumber") {
    return { number: block, timestamp: numberToHex(state.time) };
  }
  if (method === "eth_getCode") {
    return state.code.get(getAddress(codeParams.parse(params)[0])) ?? "0x";
  }
  const [{ to, data }] = callParams.parse(params);
  return answerCall(state, to, data);
}

async function replyTo<T>(state: WorldState, call: RpcCall<T>): Promise<RpcReply<T>> {
  call.signal.throwIfAborted();
  state.asked.push(call.method);
  if (state.isDown) {
    throw new BinferenceError({
      code: "chain.rpc_down",
      message: "No node answers.",
      retryable: true,
    });
  }
  const value = valueOf(state, call);
  const endpoint = "world";
  return await Promise.resolve(
    value === undefined
      ? { kind: "error", endpoint, code: 3, message: "execution reverted" }
      : { kind: "result", endpoint, value: call.result.parse(value) },
  );
}

/** Creates an empty SPACE ID world whose latest block's time is `time`. */
export function createSpaceIdWorld(time: bigint): SpaceIdWorld {
  const state: WorldState = {
    expiries: new Map(),
    resolvers: new Map(),
    addresses: new Map(),
    names: new Map(),
    broken: new Set(),
    code: new Map(),
    asked: [],
    time,
    isDown: false,
  };
  return {
    rpc: { request: async (call) => replyTo(state, call), health: () => [] },
    register: (label, expires) => state.expiries.set(BigInt(labelhash(label)), expires),
    setResolver: (name, resolver) => {
      if (resolver === undefined) {
        state.resolvers.delete(namehash(name));
      } else {
        state.resolvers.set(namehash(name), resolver);
      }
    },
    setAddress: (resolver, name, address) =>
      state.addresses.set(recordKey(resolver, namehash(name)), address),
    setReverseName: (resolver, address, name) =>
      state.names.set(recordKey(resolver, namehash(reverseNameOf(address))), name),
    breakContract: (contract) => state.broken.add(getAddress(contract)),
    setCode: (account, code = "0x6080") => state.code.set(getAddress(account), code),
    setTime: (seconds) => {
      state.time = seconds;
    },
    down: () => {
      state.isDown = true;
    },
    asked: () => [...state.asked],
  };
}
